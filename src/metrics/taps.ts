import {
  TAP_FC_HZ,
  TAP_HESITATION_ABS_MS,
  TAP_MIN_DIST_MS,
  TAP_PROM_FLOOR,
} from '../config'
import type { CycleAnalysis, LandmarkFrame } from '../types'
import { analyzeCycleTest, type CycleTestParams } from './cycleTest'
import { tapRaw } from './kinematics'

export const TAP_PARAMS: CycleTestParams = {
  raw: tapRaw,
  fcHz: TAP_FC_HZ,
  promFloor: TAP_PROM_FLOOR,
  minDistanceMs: TAP_MIN_DIST_MS,
  hesitationAbsMs: TAP_HESITATION_ABS_MS,
}

/** Finger tapping test: thumb-tip ↔ index-tip opposition. */
export function computeTapMetrics(frames: LandmarkFrame[]): CycleAnalysis {
  return analyzeCycleTest(frames, TAP_PARAMS)
}
