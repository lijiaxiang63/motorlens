import { describe, expect, it } from 'vitest'
import { computeTapMetrics } from '../metrics/taps'
import { makeTapFrames } from '../replay/synthetic'
import type { StoredResult, StoredVideo, Subject } from '../store/subjects'
import { buildBatchExport } from './batch'
import { naturalKey, planImport, type ExistingState } from './backup'
import { buildSessionReport } from './export'

function makeSubject(code: string, name = ''): Subject {
  return {
    id: `id-${code}`,
    code,
    name,
    sex: 'female',
    birthYear: 1958,
    dominantHand: 'right',
    diagnosis: '',
    notes: '',
    createdAt: '2026-07-02T09:00:00.000Z',
  }
}

function makeResult(subject: Subject, startedAt: string, videoKey?: string): StoredResult {
  const { frames } = makeTapFrames({ freqHz: 2, durationMs: 3000 })
  const report = buildSessionReport({
    test: 'finger_tap',
    hand: 'right',
    startedAt,
    durationMs: 3000,
    analysis: computeTapMetrics(frames),
    frames,
    subject: { code: subject.code },
  })
  return {
    id: `r-${subject.code}-${startedAt}`,
    subjectId: subject.id,
    testId: 'finger_tap',
    hand: 'right',
    source: 'live',
    startedAt,
    ...(videoKey ? { videoKey } : {}),
    report,
  }
}

const fakeVideoBytes = new Uint8Array(1024).map((_, i) => i % 251)

function videoStore(entries: Record<string, Partial<StoredVideo>>) {
  return (key: string): Promise<StoredVideo | undefined> => {
    const v = entries[key]
    return Promise.resolve(
      v ? { key, blob: new Blob([fakeVideoBytes]), mimeType: v.mimeType ?? 'video/webm' } : undefined,
    )
  }
}

function emptyState(): ExistingState {
  return { subjects: [], resultIds: new Set(), resultNaturalKeys: new Set(), videoKeys: new Set() }
}

function counter(prefix: string) {
  let n = 0
  return () => `${prefix}-${++n}`
}

async function buildZipBytes(): Promise<{
  bytes: Uint8Array
  s1: Subject
  s2: Subject
  r1: StoredResult
  r2: StoredResult
  r3: StoredResult
}> {
  const s1 = makeSubject('P001', 'Maria García')
  const s2 = makeSubject('P002')
  const r1 = makeResult(s1, '2026-07-02T10:15:02.000Z', 'live_a')
  const r2 = makeResult(s1, '2026-07-02T10:20:02.000Z')
  const r3 = makeResult(s2, '2026-07-02T11:00:00.000Z')
  const blob = await buildBatchExport(
    [
      { subject: s1, results: [r1, r2] },
      { subject: s2, results: [r3] },
    ],
    videoStore({ live_a: { mimeType: 'video/webm' } }),
  )
  return { bytes: new Uint8Array(await blob.arrayBuffer()), s1, s2, r1, r2, r3 }
}

describe('planImport (manifest path)', () => {
  it('preserves subject ids/createdAt, result ids, and video keys against an empty store', async () => {
    const { bytes, s1, s2, r1, r2, r3 } = await buildZipBytes()
    const plan = planImport(bytes, emptyState(), counter('mint'))

    expect(plan.source).toBe('manifest')
    expect(plan.newSubjects.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort())
    expect(plan.newSubjects.find((s) => s.code === 'P001')!.createdAt).toBe(s1.createdAt)
    expect(plan.newResults.map((r) => r.id).sort()).toEqual([r1.id, r2.id, r3.id].sort())
    expect(plan.newVideos).toHaveLength(1)
    expect(plan.newVideos[0]!.key).toBe('live_a')
    expect(plan.newVideos[0]!.mimeType).toBe('video/webm')
    const r1Plan = plan.newResults.find((r) => r.id === r1.id)!
    expect(r1Plan.videoKey).toBe('live_a')
    const r2Plan = plan.newResults.find((r) => r.id === r2.id)!
    expect(r2Plan.videoKey).toBeUndefined()
    expect(plan.skipped).toEqual({ subjects: 0, results: 0, videos: 0, unreadable: 0 })
  })

  it('is idempotent: re-planning against a fully-populated store skips everything', async () => {
    const { bytes, s1, s2, r1, r2, r3 } = await buildZipBytes()
    const existing: ExistingState = {
      subjects: [
        { id: s1.id, code: s1.code },
        { id: s2.id, code: s2.code },
      ],
      resultIds: new Set([r1.id, r2.id, r3.id]),
      resultNaturalKeys: new Set(),
      videoKeys: new Set(['live_a']),
    }
    const plan = planImport(bytes, existing, counter('mint'))

    expect(plan.newSubjects).toHaveLength(0)
    expect(plan.newResults).toHaveLength(0)
    expect(plan.newVideos).toHaveLength(0)
    expect(plan.skipped.subjects).toBe(2)
    expect(plan.skipped.results).toBe(3)
  })

  it('merges an existing subject by code, reusing its id rather than the manifest id', async () => {
    const { bytes, s1 } = await buildZipBytes()
    const existing = emptyState()
    existing.subjects.push({ id: 'local-existing-id', code: s1.code })
    const plan = planImport(bytes, existing, counter('mint'))

    expect(plan.newSubjects.find((s) => s.code === s1.code)).toBeUndefined()
    // Results for P001 resolve to the existing local subject id, not s1.id.
    const p001Results = plan.newResults.filter((r) => r.subjectId === 'local-existing-id')
    expect(p001Results.length).toBeGreaterThan(0)
    expect(plan.skipped.subjects).toBe(1)
  })

  it('mints a fresh id when a new subject id collides with an unrelated existing one', async () => {
    const { bytes, s1 } = await buildZipBytes()
    const existing = emptyState()
    // Different code, but the SAME id as the manifest's s1 — a real collision.
    existing.subjects.push({ id: s1.id, code: 'UNRELATED' })
    const mintId = counter('mint')
    const plan = planImport(bytes, existing, mintId)

    const imported = plan.newSubjects.find((s) => s.code === s1.code)!
    expect(imported.id).not.toBe(s1.id)
    expect(imported.id).toBe('mint-1')
  })
})

describe('planImport (scan fallback — manifest stripped)', () => {
  async function stripManifest(bytes: Uint8Array): Promise<Uint8Array> {
    const { unzipSync, zipSync } = await import('fflate')
    const files = unzipSync(bytes)
    delete files['manifest.json']
    const tree: Record<string, Uint8Array> = {}
    for (const [name, data] of Object.entries(files)) tree[name] = data
    return zipSync(tree, { level: 0 })
  }

  it('recreates subjects by code and dedupes results by natural key, skipping videos', async () => {
    const { bytes, s1, s2 } = await buildZipBytes()
    const scanBytes = await stripManifest(bytes)
    const plan = planImport(scanBytes, emptyState(), counter('mint'))

    expect(plan.source).toBe('scan')
    expect(plan.newSubjects.map((s) => s.code).sort()).toEqual([s1.code, s2.code].sort())
    // Minted ids, not the original StoredResult/Subject ids (unavailable without a manifest).
    expect(plan.newSubjects.every((s) => s.id.startsWith('mint-'))).toBe(true)
    expect(plan.newResults).toHaveLength(3)
    expect(plan.newVideos).toHaveLength(0) // scan fallback never restores videos

    // Re-planning the same scan against the resulting state is a no-op.
    const existing: ExistingState = {
      subjects: plan.newSubjects.map((s) => ({ id: s.id, code: s.code })),
      resultIds: new Set(),
      resultNaturalKeys: new Set(
        plan.newResults.map((r) => naturalKey(r.subjectId, r.testId, r.hand, r.startedAt)),
      ),
      videoKeys: new Set(),
    }
    const secondPlan = planImport(scanBytes, existing, counter('mint2'))
    expect(secondPlan.newResults).toHaveLength(0)
    expect(secondPlan.skipped.results).toBe(3)
  })
})

describe('planImport error handling', () => {
  it('throws a friendly error for garbage bytes', () => {
    expect(() => planImport(new Uint8Array([1, 2, 3, 4]), emptyState(), counter('mint'))).toThrow(
      /valid ZIP/,
    )
  })

  it('counts one corrupted report JSON as unreadable but imports the rest', async () => {
    const { bytes } = await buildZipBytes()
    const { unzipSync, zipSync, strToU8 } = await import('fflate')
    const files = unzipSync(bytes)
    const jsonPath = Object.keys(files).find(
      (n) => n.endsWith('.json') && n !== 'manifest.json',
    )!
    files[jsonPath] = strToU8('not valid json{{{')
    const corrupted = zipSync(files, { level: 0 })

    const plan = planImport(corrupted, emptyState(), counter('mint'))
    expect(plan.skipped.unreadable).toBeGreaterThanOrEqual(1)
    expect(plan.newResults.length).toBe(2) // the other two reports still import
  })
})
