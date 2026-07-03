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
const PINKY_MCP = 17

/** Wrapped palm roll, degrees in (−180, 180]: the palm normal
 *  n = (W5−W0)×(W17−W0) projected onto the camera's x/z plane,
 *  φ = atan2(n.z, n.x). atan2 is scale-invariant, so n needs no
 *  normalization. A flat palm facing the camera reads ≈ ±90°; rigid
 *  rotation about the vertical (forearm) axis sweeps φ linearly. */
export function rollDeg(world: Vec3[]): number {
  const w = world[WRIST]!
  const i = world[INDEX_MCP]!
  const p = world[PINKY_MCP]!
  const ax = i.x - w.x
  const ay = i.y - w.y
  const az = i.z - w.z
  const bx = p.x - w.x
  const by = p.y - w.y
  const bz = p.z - w.z
  const nx = ay * bz - az * by
  const nz = ax * by - ay * bx
  return (Math.atan2(nz, nx) * 180) / Math.PI
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
  let prevT = -Infinity
  let prevWrapped = 0
  let offset = 0
  let inRun = false
  for (const f of frames) {
    if (!f.landmarks || !f.world) continue
    const ws = worldHandScale(f.world)
    if (ws < 1e-6) continue
    rawScales.push(rawHandScale(f.landmarks, f.aspect))
    const wrapped = rollDeg(f.world)
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
