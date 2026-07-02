// Backup ZIP import — the browser→desktop data bridge (IDB is per-origin;
// this is how subjects recorded in a browser build reach the desktop app).
// Pure: bytes + a snapshot of what's already stored in → a write plan out.
// The actual IndexedDB reads/writes live in store/backup.ts so this module
// never touches a browser API and stays node-testable like every other
// analysis module.

import { strFromU8, unzipSync } from 'fflate'
import type { Subject, StoredResult } from '../store/subjects'
import type { Hand, SessionReport, TestId } from '../types'
import { parseSessionJson } from './export'

/** Additive manifest written at the ZIP root by buildBatchExport (batch.ts).
 *  Older/manifest-less exports fall back to the scan path below.
 *  test/hand/source/startedAt are deliberately omitted — they're recoverable
 *  from the report JSON at `path`. */
export interface BackupManifest {
  schemaVersion: 1
  app: { name: 'MotorLens'; version: string }
  exportedAt: string
  subjects: Subject[]
  results: {
    id: string
    subjectCode: string
    /** ZIP path of the report JSON. */
    path: string
    videoKey?: string
    /** ZIP path of the video, when the video restored (see below). */
    videoPath?: string
    mimeType?: string
    fileName?: string
  }[]
}

/** A snapshot of what's already in IndexedDB, used to decide what's new. */
export interface ExistingState {
  subjects: { id: string; code: string }[]
  resultIds: Set<string>
  /** `${subjectId}|${testId}|${hand}|${startedAt}` — the scan-fallback's
   *  dedupe key, since manifest-less reports carry no id. */
  resultNaturalKeys: Set<string>
  videoKeys: Set<string>
}

export interface ImportPlan {
  source: 'manifest' | 'scan'
  /** Ids already resolved: reused for a matching existing code, otherwise
   *  the manifest's own id (or a freshly minted one on a collision). */
  newSubjects: Subject[]
  newResults: StoredResult[]
  newVideos: { key: string; bytes: Uint8Array; mimeType: string; fileName?: string }[]
  skipped: { subjects: number; results: number; videos: number; unreadable: number }
}

function emptySkipped(): ImportPlan['skipped'] {
  return { subjects: 0, results: 0, videos: 0, unreadable: 0 }
}

function planFromManifest(
  files: Record<string, Uint8Array>,
  manifestBytes: Uint8Array,
  existing: ExistingState,
  mintId: () => string,
): ImportPlan {
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(strFromU8(manifestBytes)) as BackupManifest
  } catch {
    throw new Error('Not a valid MotorLens backup ZIP (unreadable manifest)')
  }
  if (manifest.schemaVersion !== 1 || manifest.app?.name !== 'MotorLens') {
    throw new Error('Not a MotorLens backup ZIP')
  }

  const skipped = emptySkipped()
  const existingCodes = new Map(existing.subjects.map((s) => [s.code, s.id]))
  const existingIds = new Set(existing.subjects.map((s) => s.id))
  const codeToId = new Map<string, string>()
  const newSubjects: Subject[] = []

  for (const subject of manifest.subjects) {
    const existingId = existingCodes.get(subject.code)
    if (existingId !== undefined) {
      codeToId.set(subject.code, existingId)
      skipped.subjects++
      continue
    }
    const id = existingIds.has(subject.id) ? mintId() : subject.id
    codeToId.set(subject.code, id)
    newSubjects.push({ ...subject, id })
  }

  const newResults: StoredResult[] = []
  const newVideos: ImportPlan['newVideos'] = []
  const seenVideoKeys = new Set<string>()

  for (const entry of manifest.results) {
    if (existing.resultIds.has(entry.id)) {
      skipped.results++
      continue
    }
    const subjectId = codeToId.get(entry.subjectCode)
    const reportBytes = subjectId !== undefined ? files[entry.path] : undefined
    if (subjectId === undefined || !reportBytes) {
      skipped.unreadable++
      continue
    }
    let report: SessionReport
    try {
      report = parseSessionJson(strFromU8(reportBytes))
    } catch {
      skipped.unreadable++
      continue
    }

    let videoKey: string | undefined
    if (entry.videoKey) {
      videoKey = entry.videoKey
      if (existing.videoKeys.has(entry.videoKey) || seenVideoKeys.has(entry.videoKey)) {
        skipped.videos++
      } else if (entry.videoPath && files[entry.videoPath]) {
        newVideos.push({
          key: entry.videoKey,
          bytes: files[entry.videoPath]!,
          mimeType: entry.mimeType ?? 'application/octet-stream',
          ...(entry.fileName ? { fileName: entry.fileName } : {}),
        })
        seenVideoKeys.add(entry.videoKey)
      } else {
        // Referenced but the bytes aren't in this zip — keep the result,
        // just drop the dangling video reference.
        videoKey = undefined
        skipped.unreadable++
      }
    }

    newResults.push({
      id: entry.id,
      subjectId,
      testId: report.test,
      hand: report.hand,
      source: report.source?.kind ?? 'live',
      startedAt: report.startedAt,
      ...(videoKey ? { videoKey } : {}),
      report,
    })
  }

  return { source: 'manifest', newSubjects, newResults, newVideos, skipped }
}

function planFromScan(
  files: Record<string, Uint8Array>,
  existing: ExistingState,
  mintId: () => string,
): ImportPlan {
  const skipped = emptySkipped()
  const reportPaths = Object.keys(files).filter(
    (p) => /^[^/]+\/[^/]+\.json$/.test(p) && p !== 'manifest.json',
  )

  const parsed: { report: SessionReport; code: string }[] = []
  for (const path of reportPaths) {
    try {
      const report = parseSessionJson(strFromU8(files[path]!))
      if (!report.subject?.code) {
        skipped.unreadable++
        continue
      }
      parsed.push({ report, code: report.subject.code })
    } catch {
      skipped.unreadable++
    }
  }

  if (parsed.length === 0) {
    throw new Error('Not a MotorLens backup ZIP')
  }

  const existingCodes = new Map(existing.subjects.map((s) => [s.code, s.id]))
  const earliestStartedAtByCode = new Map<string, string>()
  for (const { report, code } of parsed) {
    const cur = earliestStartedAtByCode.get(code)
    if (!cur || report.startedAt < cur) earliestStartedAtByCode.set(code, report.startedAt)
  }

  const codeToId = new Map<string, string>()
  const newSubjects: Subject[] = []
  for (const [code, createdAt] of earliestStartedAtByCode) {
    const existingId = existingCodes.get(code)
    if (existingId !== undefined) {
      codeToId.set(code, existingId)
      skipped.subjects++
      continue
    }
    const id = mintId()
    codeToId.set(code, id)
    const rs = parsed.find((p) => p.code === code)!.report.subject!
    newSubjects.push({
      id,
      code,
      name: rs.name ?? '',
      sex: rs.sex ?? '',
      birthYear: rs.birthYear ?? null,
      dominantHand: rs.dominantHand ?? '',
      diagnosis: rs.diagnosis ?? '',
      notes: rs.notes ?? '',
      createdAt,
    })
  }

  const newResults: StoredResult[] = []
  const seenKeys = new Set(existing.resultNaturalKeys)
  for (const { report, code } of parsed) {
    const subjectId = codeToId.get(code)!
    const key = naturalKey(subjectId, report.test, report.hand, report.startedAt)
    if (seenKeys.has(key)) {
      skipped.results++
      continue
    }
    seenKeys.add(key)
    newResults.push({
      id: mintId(),
      subjectId,
      testId: report.test,
      hand: report.hand,
      source: report.source?.kind ?? 'live',
      startedAt: report.startedAt,
      report,
    })
  }

  // Videos are deliberately not restored on the scan fallback (no manifest
  // means no reliable id→video-key mapping) — keep it simple.
  return { source: 'scan', newSubjects, newResults, newVideos: [], skipped }
}

export function naturalKey(subjectId: string, testId: TestId, hand: Hand, startedAt: string): string {
  return `${subjectId}|${testId}|${hand}|${startedAt}`
}

/** Parses a MotorLens batch-export ZIP and computes what's new relative to
 *  `existing`, without touching any store. Throws a friendly error for a
 *  non-ZIP or non-MotorLens archive. */
export function planImport(
  zipBytes: Uint8Array,
  existing: ExistingState,
  mintId: () => string,
): ImportPlan {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zipBytes)
  } catch {
    throw new Error('Not a valid ZIP file')
  }

  const manifestBytes = files['manifest.json']
  if (manifestBytes) return planFromManifest(files, manifestBytes, existing, mintId)
  return planFromScan(files, existing, mintId)
}
