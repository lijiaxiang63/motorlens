// Timed range-of-motion test (family 'rom'): per-joint flexion series →
// zero-phase smoothing → min/max/ROM/peak-angular-velocity summaries, with
// per-finger and total active ROM sums. The untimed joint monitor
// (JointTracker) stays the live sibling; this is the offline pipeline for a
// recorded 10 s guided open/close.

import { ANGLE_FC_HZ, MAX_GAP_MS } from '../config'
import { centralDiff, smoothZeroPhase } from '../signal/filters'
import type {
  Finger,
  JointId,
  JointSummaries,
  LandmarkFrame,
  RomAnalysis,
  RomMetrics,
  Series,
} from '../types'
import { computeJointSeries, JOINT_IDS } from './angles'
import { computeFrameQuality } from './cycleTest'
import { rawHandScale, splitSeries, worldHandScale } from './kinematics'

export const FINGER_JOINTS: Record<Finger, readonly JointId[]> = {
  thumb: ['thumb_cmc', 'thumb_mcp', 'thumb_ip'],
  index: ['index_mcp', 'index_pip', 'index_dip'],
  middle: ['middle_mcp', 'middle_pip', 'middle_dip'],
  ring: ['ring_mcp', 'ring_pip', 'ring_dip'],
  pinky: ['pinky_mcp', 'pinky_pip', 'pinky_dip'],
}

const FINGERS = Object.keys(FINGER_JOINTS) as Finger[]

export function computeRomMetrics(frames: LandmarkFrame[]): RomAnalysis {
  // Same detected-frame filter as the cycle extractors, so quality metrics
  // are computed on the same basis across families.
  const detected: LandmarkFrame[] = []
  const rawScales: number[] = []
  for (const f of frames) {
    if (!f.landmarks || !f.world) continue
    if (worldHandScale(f.world) < 1e-6) continue
    detected.push(f)
    rawScales.push(rawHandScale(f.landmarks, f.aspect))
  }

  const raw = computeJointSeries(detected)

  const joints = {} as JointSummaries
  const jointSeries = {} as Record<JointId, Series>
  let segmentCount = 0
  for (const id of JOINT_IDS) {
    // All joints share one time base; split at tracking gaps so smoothing
    // and velocities never run across a dropout.
    const segments = splitSeries(raw[id], MAX_GAP_MS)
    segmentCount = segments.length
    const t: number[] = []
    const v: number[] = []
    let min = Infinity
    let max = -Infinity
    let peakVel = 0
    for (const seg of segments) {
      const smooth = smoothZeroPhase(seg.t, seg.v, ANGLE_FC_HZ)
      const vel = centralDiff(seg.t, smooth)
      for (let i = 0; i < smooth.length; i++) {
        const angle = smooth[i]!
        if (angle < min) min = angle
        if (angle > max) max = angle
        const speed = Math.abs(vel[i]!)
        if (speed > peakVel) peakVel = speed
        t.push(seg.t[i]!)
        v.push(angle)
      }
    }
    jointSeries[id] = { t, v }
    const seen = v.length > 0
    joints[id] = {
      currentDeg: seen ? v[v.length - 1]! : null,
      minDeg: seen ? min : null,
      maxDeg: seen ? max : null,
      romDeg: seen ? max - min : null,
      peakAngVelDegS: seen ? peakVel : null,
    }
  }

  const perFinger = {} as Record<Finger, number | null>
  let total: number | null = null
  for (const finger of FINGERS) {
    let sum: number | null = null
    for (const id of FINGER_JOINTS[finger]) {
      const rom = joints[id].romDeg
      if (rom !== null) sum = (sum ?? 0) + rom
    }
    perFinger[finger] = sum
    if (sum !== null) total = (total ?? 0) + sum
  }

  const metrics: RomMetrics = { joints, perFinger, totalActiveRomDeg: total }

  // Total-flexion trace (sum over all joints at each shared sample) — the
  // one-series summary that becomes report.series.
  const base = jointSeries[JOINT_IDS[0]!]!
  const signal: Series = { t: [...base.t], v: base.t.map(() => 0) }
  for (const id of JOINT_IDS) {
    const s = jointSeries[id]
    for (let i = 0; i < s.v.length; i++) signal.v[i]! += s.v[i]!
  }

  return {
    metrics,
    signal,
    events: [],
    jointSeries,
    quality: computeFrameQuality(frames, rawScales, Math.max(0, segmentCount - 1)),
  }
}
