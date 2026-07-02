import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { computeTapMetrics } from '../metrics/taps'
import { makeTapFrames } from '../replay/synthetic'
import type { StoredResult, StoredVideo, Subject } from '../store/subjects'
import { buildBatchExport, slug } from './batch'
import { SUMMARY_COLUMNS } from './csv'
import { buildSessionReport, parseSessionJson } from './export'

function makeSubject(code: string, name: string): Subject {
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

function makeResult(
  subject: Subject,
  startedAt: string,
  videoKey?: string,
  source: 'live' | 'video' = 'live',
): StoredResult {
  const { frames } = makeTapFrames({ freqHz: 2, durationMs: 3000 })
  const report = buildSessionReport({
    test: 'finger_tap',
    hand: 'right',
    startedAt,
    durationMs: 3000,
    analysis: computeTapMetrics(frames),
    frames,
    subject: { code: subject.code },
    source: { kind: source },
  })
  return {
    id: `r-${subject.code}-${startedAt}`,
    subjectId: subject.id,
    testId: 'finger_tap',
    hand: 'right',
    source,
    startedAt,
    ...(videoKey ? { videoKey } : {}),
    report,
  }
}

const fakeVideoBytes = new Uint8Array(2048).map((_, i) => i % 251)

function videoStore(entries: Record<string, Partial<StoredVideo>>) {
  return (key: string): Promise<StoredVideo | undefined> => {
    const v = entries[key]
    return Promise.resolve(
      v
        ? {
            key,
            blob: new Blob([fakeVideoBytes]),
            mimeType: v.mimeType ?? 'video/webm',
            ...(v.fileName ? { fileName: v.fileName } : {}),
          }
        : undefined,
    )
  }
}

describe('batch export ZIP', () => {
  it('lays out summary.csv + per-subject folders with reports and videos', async () => {
    const s1 = makeSubject('P001', 'Maria García')
    const s2 = makeSubject('P002', '')
    const blob = await buildBatchExport(
      [
        {
          subject: s1,
          results: [
            makeResult(s1, '2026-07-02T10:15:02.000Z', 'live_a'),
            makeResult(s1, '2026-07-02T10:20:02.000Z'),
          ],
        },
        { subject: s2, results: [makeResult(s2, '2026-07-02T11:00:00.000Z')] },
      ],
      videoStore({ live_a: { mimeType: 'video/webm' } }),
    )
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const names = Object.keys(files).sort()

    expect(names).toContain('summary.csv')
    expect(names.filter((n) => n.startsWith('p001_maria-garcía/'))).toHaveLength(3) // 2 json + 1 webm
    expect(names.filter((n) => n.startsWith('p002/'))).toHaveLength(1)
    const videoName = names.find((n) => n.endsWith('.webm'))!
    expect(files[videoName]!.length).toBe(fakeVideoBytes.length) // level 0 keeps bytes

    // CSV: BOM + header + 3 rows, video path points at the stored entry.
    // (strFromU8's TextDecoder strips the BOM, so check the raw bytes.)
    const csvBytes = files['summary.csv']!
    expect([csvBytes[0], csvBytes[1], csvBytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const csv = strFromU8(csvBytes)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(SUMMARY_COLUMNS.join(','))
    expect(lines.length).toBe(1 + 3)
    expect(csv).toContain(videoName)

    // Report JSONs round-trip through the importer.
    const jsonName = names.find((n) => n.endsWith('.json'))!
    const parsed = parseSessionJson(strFromU8(files[jsonName]!))
    expect(parsed.subject?.code).toBe('P001')
  })

  it('shares one video file across segments of the same upload', async () => {
    const s = makeSubject('P003', 'x')
    const r1 = makeResult(s, '2026-07-02T10:00:00.000Z', 'upload_u1', 'video')
    const r2 = makeResult(s, '2026-07-02T10:00:20.000Z', 'upload_u1', 'video')
    const blob = await buildBatchExport(
      [{ subject: s, results: [r1, r2] }],
      videoStore({ upload_u1: { mimeType: 'video/mp4', fileName: 'left session.MP4' } }),
    )
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const videos = Object.keys(files).filter((n) => n.endsWith('.mp4'))
    expect(videos).toEqual(['p003_x/video_left-session.mp4'])
    const csv = strFromU8(files['summary.csv']!)
    // Both rows reference the single shared file.
    expect(csv.split('p003_x/video_left-session.mp4').length - 1).toBe(2)
  })

  it('suffixes colliding report filenames', async () => {
    const s = makeSubject('P004', '')
    const t = '2026-07-02T10:00:00.000Z'
    const blob = await buildBatchExport(
      [{ subject: s, results: [makeResult(s, t), makeResult(s, t)] }],
      videoStore({}),
    )
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const jsons = Object.keys(files)
      .filter((n) => n.endsWith('.json'))
      .sort()
    expect(jsons).toHaveLength(2)
    expect(jsons[1]).toMatch(/_2\.json$/)
  })

  it('slugifies unicode and empty strings safely', () => {
    expect(slug('Maria García')).toBe('maria-garcía')
    expect(slug('  ++  ')).toBe('x')
    expect(slug('P-001')).toBe('p-001')
  })
})
