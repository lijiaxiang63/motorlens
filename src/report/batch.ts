// Batch export: every subject's reports + videos + a summary CSV in one ZIP.
//
// Uses fflate's synchronous zipSync so this module stays unit-testable in
// node (the async variant needs Web Workers). Everything is assembled in
// memory — fine for tens of subjects (a 10 s webm is ~2–5 MB); hundreds of
// videos would need the streaming Zip class + File System Access API.

import { strToU8, zipSync, type Zippable } from 'fflate'
import { savePlatformFile } from '../platform'
import type { StoredResult, StoredVideo, Subject } from '../store/subjects'
import { buildSummaryCsv, buildSummaryRow } from './csv'
import { reportFileName, stamp } from './export'

export interface ExportEntry {
  subject: Subject
  results: StoredResult[]
}

export function slug(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'x'
}

function extFromMime(mimeType: string, fallbackName?: string): string {
  if (mimeType.includes('webm')) return '.webm'
  if (mimeType.includes('mp4')) return '.mp4'
  const m = fallbackName?.match(/(\.[A-Za-z0-9]+)$/)
  return m?.[1]?.toLowerCase() ?? '.bin'
}

/** Insert `_2`, `_3`… before the extension until the name is unused. */
function dedupe(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)
  for (let i = 2; ; i++) {
    const candidate = `${stem}_${i}${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

export async function buildBatchExport(
  entries: ExportEntry[],
  getVideo: (key: string) => Promise<StoredVideo | undefined>,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const tree: Zippable = {}
  const rows: string[][] = []
  const usedFolders = new Set<string>()
  const total = entries.reduce((n, e) => n + e.results.length, 0)
  let done = 0

  for (const { subject, results } of entries) {
    const base = slug(subject.code) + (subject.name ? `_${slug(subject.name)}` : '')
    const folder = dedupe(base, usedFolders)
    const usedNames = new Set<string>()
    // Uploaded source files are shared by several segment results — write
    // each video once per key and point every row at the same ZIP path.
    const videoPathByKey = new Map<string, string>()

    for (const result of results.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
      const jsonName = dedupe(reportFileName(result.report), usedNames)
      tree[`${folder}/${jsonName}`] = [strToU8(JSON.stringify(result.report)), { level: 6 }]

      let videoPath = ''
      if (result.videoKey) {
        const existing = videoPathByKey.get(result.videoKey)
        if (existing !== undefined) {
          videoPath = existing
        } else {
          const video = await getVideo(result.videoKey)
          if (video) {
            const ext = extFromMime(video.mimeType, video.fileName)
            const name = video.fileName
              ? `video_${slug(video.fileName.replace(/\.[A-Za-z0-9]+$/, ''))}${ext}`
              : jsonName.replace(/\.json$/, ext)
            const videoName = dedupe(name, usedNames)
            // Already-compressed media: store, don't deflate.
            tree[`${folder}/${videoName}`] = [new Uint8Array(await video.blob.arrayBuffer()), { level: 0 }]
            videoPath = `${folder}/${videoName}`
          }
          videoPathByKey.set(result.videoKey, videoPath)
        }
      }

      rows.push(buildSummaryRow(subject, result, videoPath, `${folder}/${jsonName}`))
      done++
      onProgress?.(done, total)
    }
  }

  tree['summary.csv'] = [strToU8(buildSummaryCsv(rows)), { level: 6 }]
  const zipped = zipSync(tree)
  return new Blob([zipped as BlobPart], { type: 'application/zip' })
}

export function batchExportFileName(now = new Date()): string {
  return `motorlens_export_${stamp(now.toISOString())}.zip`
}

export async function downloadBatchExport(blob: Blob): Promise<void> {
  await savePlatformFile(blob, batchExportFileName(), [{ name: 'ZIP archive', extensions: ['zip'] }])
}
