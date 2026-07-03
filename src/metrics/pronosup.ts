// Pronation-supination (UPDRS 3.6 analogue): palm-roll angle from world
// landmarks, fed through the shared cycle engine. The signal is an ANGLE in
// degrees — no hand-scale normalization (rotation amplitude is scale-free),
// so cmPerUnit is null and the cm-derived metrics stay null by construction.

import {
  MAX_GAP_MS,
  PRONOSUP_FC_HZ,
  PRONOSUP_HESITATION_ABS_MS,
  PRONOSUP_MIN_DIST_MS,
  PRONOSUP_PROM_FLOOR,
} from '../config'
import type { CycleAnalysis, LandmarkFrame, Vec3 } from '../types'
import { analyzeCycleTest, type CycleTestParams } from './cycleTest'
import { rawHandScale, worldHandScale, type ExtractedSignal } from './kinematics'

const WRIST = 0
const INDEX_MCP = 5
const MIDDLE_MCP = 9
const PINKY_MCP = 17

/** Reference axis for the roll basis: the camera axis (ŷ or ẑ) used to
 *  anchor "0°" in the plane perpendicular to the hand's long axis. */
export type RollRef = 'y' | 'z'

/** Wrapped palm roll, degrees in (−180, 180]: the rotation of the palm
 *  normal n = (W5−W0)×(W17−W0) about the hand's long axis â = W9−W0
 *  (wrist → middle MCP, ≈ collinear with the forearm — the axis
 *  pronation-supination actually rotates about, whatever the arm posture).
 *  A reference axis r (the camera axis least parallel to â, or the caller's
 *  fixed choice) is projected into the plane ⊥ â to build an orthonormal-up-
 *  to-scale basis u = r − (r·â)â, v = â×u; φ = atan2(n·v, n·u). atan2 is
 *  scale-invariant, so neither n nor u/v needs explicit normalization
 *  (|v| = |u| because â is unit).
 *
 *  This is posture-adaptive: forearm upright (â ≈ ±ŷ, r = ẑ) reproduces the
 *  old x/z-plane projection up to a constant offset, and an arm extended
 *  toward the camera (â ≈ ±ẑ, r = ŷ) sweeps φ linearly too — where the old
 *  fixed x/z projection degenerated to atan2 of two near-zero numbers.
 *  Rigid rotation about â sweeps φ exactly linearly; a flat palm facing the
 *  camera in the upright posture reads ≈ 0°.
 *
 *  Callers that analyze a whole recording should pass one fixed `ref` for
 *  all frames (see extractRollSignal) so a posture near the 45° boundary
 *  cannot flip the reference — and hence the angle's offset — mid-signal.
 *  Without `ref` the least-parallel axis is picked per frame (live chart). */
export function rollDeg(world: Vec3[], ref?: RollRef): number {
  const w = world[WRIST]!
  const i = world[INDEX_MCP]!
  const m = world[MIDDLE_MCP]!
  const p = world[PINKY_MCP]!
  // Hand long axis â (unit).
  let ax = m.x - w.x
  let ay = m.y - w.y
  let az = m.z - w.z
  const al = Math.hypot(ax, ay, az)
  if (al < 1e-9) return 0
  ax /= al
  ay /= al
  az /= al
  // Palm normal n = (W5−W0)×(W17−W0), unnormalized.
  const e1x = i.x - w.x
  const e1y = i.y - w.y
  const e1z = i.z - w.z
  const e2x = p.x - w.x
  const e2y = p.y - w.y
  const e2z = p.z - w.z
  const nx = e1y * e2z - e1z * e2y
  const ny = e1z * e2x - e1x * e2z
  const nz = e1x * e2y - e1y * e2x
  // Basis ⊥ â from the reference axis: u = r − (r·â)â, v = â×u.
  const r = ref ?? (Math.abs(ay) >= Math.abs(az) ? 'z' : 'y')
  let ux: number
  let uy: number
  let uz: number
  if (r === 'z') {
    ux = -az * ax
    uy = -az * ay
    uz = 1 - az * az
  } else {
    ux = -ay * ax
    uy = 1 - ay * ay
    uz = -ay * az
  }
  const vx = ay * uz - az * uy
  const vy = az * ux - ax * uz
  const vz = ax * uy - ay * ux
  return (Math.atan2(nx * vx + ny * vy + nz * vz, nx * ux + ny * uy + nz * uz) * 180) / Math.PI
}

/** One reference axis for a whole recording: the camera axis least parallel
 *  to the MEAN hand long axis over all detected frames. The posture is held
 *  for the duration of a test, so a single global pick is stable — and it
 *  guarantees the roll offset cannot jump mid-run for forearm angles near
 *  the 45° boundary, which would corrupt the unwrap. */
export function pickRollRef(frames: LandmarkFrame[]): RollRef {
  let sumY = 0
  let sumZ = 0
  for (const f of frames) {
    if (!f.landmarks || !f.world) continue
    const w = f.world[WRIST]!
    const m = f.world[MIDDLE_MCP]!
    sumY += m.y - w.y
    sumZ += m.z - w.z
  }
  return Math.abs(sumY) >= Math.abs(sumZ) ? 'z' : 'y'
}

/** Roll signal in degrees, unwrapped per contiguous run: whenever the frame
 *  time jumps by more than MAX_GAP_MS the unwrap state RESETS — a wrong 360°
 *  branch must never leak across a dropout, where it would inflate the
 *  whole-signal p90−p10 and corrupt the adaptive peak prominence.
 *  splitSeries later splits at the same gaps, so each analyzed segment sees
 *  one clean branch. cmPerUnit is null: degrees have no cm equivalent. */
export function extractRollSignal(frames: LandmarkFrame[]): ExtractedSignal {
  const t: number[] = []
  const v: number[] = []
  const rawScales: number[] = []
  const ref = pickRollRef(frames)
  let prevT = -Infinity
  let prevWrapped = 0
  let offset = 0
  let inRun = false
  for (const f of frames) {
    if (!f.landmarks || !f.world) continue
    const ws = worldHandScale(f.world)
    if (ws < 1e-6) continue
    rawScales.push(rawHandScale(f.landmarks, f.aspect))
    const wrapped = rollDeg(f.world, ref)
    if (!inRun || f.t - prevT > MAX_GAP_MS) {
      offset = 0
    } else {
      const step = wrapped - prevWrapped
      if (step > 180) offset -= 360
      else if (step < -180) offset += 360
    }
    inRun = true
    prevWrapped = wrapped
    prevT = f.t
    t.push(f.t)
    v.push(wrapped + offset)
  }
  return { series: { t, v }, rawScales, cmPerUnit: null }
}

export const PRONOSUP_PARAMS: CycleTestParams = {
  extract: extractRollSignal,
  fcHz: PRONOSUP_FC_HZ,
  promFloor: PRONOSUP_PROM_FLOOR,
  minDistanceMs: PRONOSUP_MIN_DIST_MS,
  hesitationAbsMs: PRONOSUP_HESITATION_ABS_MS,
}

/** Pronation-supination test: palm-roll rotation cycles, amplitudes in °. */
export function computePronosupMetrics(frames: LandmarkFrame[]): CycleAnalysis {
  return analyzeCycleTest(frames, PRONOSUP_PARAMS)
}
