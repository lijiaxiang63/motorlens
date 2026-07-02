// SessionReport building, JSON download, and import validation. Imported
// reports are replayed through the normal pipeline (raw frames → metrics),
// which doubles as a regression harness on real recordings.

import { APP_VERSION } from '../config'
import type {
  CycleAnalysis,
  Hand,
  JointSummaries,
  LandmarkFrame,
  SessionReport,
  TestId,
  Vec3,
} from '../types'

const r4 = (x: number) => Math.round(x * 10_000) / 10_000
const roundVec = (v: Vec3): Vec3 => ({ x: r4(v.x), y: r4(v.y), z: r4(v.z) })

function compactFrames(frames: LandmarkFrame[]): LandmarkFrame[] {
  return frames.map((f) => ({
    ...f,
    t: Math.round(f.t * 10) / 10,
    landmarks: f.landmarks ? f.landmarks.map(roundVec) : null,
    world: f.world ? f.world.map(roundVec) : null,
  }))
}

export function buildSessionReport(args: {
  test: TestId
  hand: Hand
  startedAt: string
  durationMs: number
  analysis: CycleAnalysis | null
  jointSummaries?: JointSummaries
  frames: LandmarkFrame[]
}): SessionReport {
  const { analysis } = args
  return {
    schemaVersion: 1,
    app: { name: 'MotorLens', version: APP_VERSION },
    test: args.test,
    hand: args.hand,
    startedAt: args.startedAt,
    durationMs: Math.round(args.durationMs),
    quality: analysis?.quality ?? null,
    metrics: analysis?.metrics ?? args.jointSummaries ?? ({} as JointSummaries),
    series: analysis?.signal ?? { t: [], v: [] },
    events: analysis?.events ?? [],
    raw: { frames: compactFrames(args.frames) },
  }
}

function stamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function downloadReport(report: SessionReport): void {
  const blob = new Blob([JSON.stringify(report)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `motorlens_${report.test}_${report.hand}_${stamp(report.startedAt)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5_000)
}

export function parseSessionJson(text: string): SessionReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not valid JSON')
  }
  const rep = parsed as SessionReport
  if (rep?.schemaVersion !== 1) throw new Error('Unsupported or missing schemaVersion')
  if (rep.app?.name !== 'MotorLens') throw new Error('Not a MotorLens session file')
  if (!Array.isArray(rep.raw?.frames) || rep.raw.frames.length === 0) {
    throw new Error('Session file contains no frames')
  }
  const f = rep.raw.frames[0]!
  if (typeof f.t !== 'number' || !('landmarks' in f)) throw new Error('Malformed frame data')
  return rep
}
