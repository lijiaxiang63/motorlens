// Per-joint flexion angles from 3-D world landmarks.
// Flexion = 180° − interior angle at the joint (0° = straight finger).

import { ANGLE_FC_HZ } from '../config'
import { LiveEma } from '../signal/filters'
import type { JointId, JointSummaries, LandmarkFrame, Series, Vec3 } from '../types'

/** [proximal, joint, distal] landmark indices per joint. */
export const JOINT_DEFS: Record<JointId, readonly [number, number, number]> = {
  thumb_cmc: [0, 1, 2],
  thumb_mcp: [1, 2, 3],
  thumb_ip: [2, 3, 4],
  index_mcp: [0, 5, 6],
  index_pip: [5, 6, 7],
  index_dip: [6, 7, 8],
  middle_mcp: [0, 9, 10],
  middle_pip: [9, 10, 11],
  middle_dip: [10, 11, 12],
  ring_mcp: [0, 13, 14],
  ring_pip: [13, 14, 15],
  ring_dip: [14, 15, 16],
  pinky_mcp: [0, 17, 18],
  pinky_pip: [17, 18, 19],
  pinky_dip: [18, 19, 20],
}

export const JOINT_IDS = Object.keys(JOINT_DEFS) as JointId[]

export function jointFlexionDeg(world: Vec3[], joint: JointId): number {
  const [ai, ji, ci] = JOINT_DEFS[joint]
  const a = world[ai]!
  const j = world[ji]!
  const c = world[ci]!
  const v1x = a.x - j.x
  const v1y = a.y - j.y
  const v1z = a.z - j.z
  const v2x = c.x - j.x
  const v2y = c.y - j.y
  const v2z = c.z - j.z
  const m = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z)
  if (m < 1e-12) return 0
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y + v1z * v2z) / m))
  return 180 - (Math.acos(cos) * 180) / Math.PI
}

/** Offline: full angle series per joint over a recording. */
export function computeJointSeries(frames: LandmarkFrame[]): Record<JointId, Series> {
  const out = {} as Record<JointId, Series>
  for (const id of JOINT_IDS) out[id] = { t: [], v: [] }
  for (const f of frames) {
    if (!f.world) continue
    for (const id of JOINT_IDS) {
      out[id].t.push(f.t)
      out[id].v.push(jointFlexionDeg(f.world, id))
    }
  }
  return out
}

interface JointState {
  ema: LiveEma
  series: Series
  min: number
  max: number
  peakAngVel: number
  lastT: number | null
  lastV: number | null
  current: number | null
}

/** Live per-joint tracker for the monitor screen: smoothed angle, min/max,
 *  range of motion, and peak angular velocity since the last reset. */
export class JointTracker {
  private states = new Map<JointId, JointState>()
  /** Keep at most this much series history per joint (chart window). */
  constructor(private historyMs = 30_000) {
    this.reset()
  }

  push(f: LandmarkFrame): void {
    if (!f.world) return
    for (const id of JOINT_IDS) {
      const st = this.states.get(id)!
      const angle = st.ema.push(f.t, jointFlexionDeg(f.world, id))
      if (st.lastT !== null && f.t > st.lastT) {
        const vel = Math.abs(((angle - st.lastV!) / (f.t - st.lastT)) * 1000)
        if (vel > st.peakAngVel) st.peakAngVel = vel
      }
      st.lastT = f.t
      st.lastV = angle
      st.current = angle
      if (angle < st.min) st.min = angle
      if (angle > st.max) st.max = angle
      st.series.t.push(f.t)
      st.series.v.push(angle)
      while (st.series.t.length > 1 && f.t - st.series.t[0]! > this.historyMs) {
        st.series.t.shift()
        st.series.v.shift()
      }
    }
  }

  series(id: JointId): Series {
    return this.states.get(id)!.series
  }

  summaries(): JointSummaries {
    const out = {} as JointSummaries
    for (const id of JOINT_IDS) {
      const st = this.states.get(id)!
      const seen = st.current !== null
      out[id] = {
        currentDeg: st.current,
        minDeg: seen ? st.min : null,
        maxDeg: seen ? st.max : null,
        romDeg: seen ? st.max - st.min : null,
        peakAngVelDegS: seen ? st.peakAngVel : null,
      }
    }
    return out
  }

  /** Reset min/max/ROM/peak-velocity accumulators (keeps chart history). */
  reset(): void {
    for (const id of JOINT_IDS) {
      const prev = this.states.get(id)
      this.states.set(id, {
        ema: new LiveEma(ANGLE_FC_HZ),
        series: prev?.series ?? { t: [], v: [] },
        min: Infinity,
        max: -Infinity,
        peakAngVel: 0,
        lastT: null,
        lastV: null,
        current: prev?.current ?? null,
      })
    }
  }
}
