import {
  FIST_FC_HZ,
  FIST_HESITATION_ABS_MS,
  FIST_MIN_DIST_MS,
  FIST_PROM_FLOOR,
} from '../config'
import type { CycleAnalysis, LandmarkFrame } from '../types'
import { analyzeCycleTest, type CycleTestParams } from './cycleTest'
import { apertureRaw, extractSignal } from './kinematics'

export const FIST_PARAMS: CycleTestParams = {
  extract: (frames) => extractSignal(frames, apertureRaw),
  fcHz: FIST_FC_HZ,
  promFloor: FIST_PROM_FLOOR,
  minDistanceMs: FIST_MIN_DIST_MS,
  hesitationAbsMs: FIST_HESITATION_ABS_MS,
}

/** Fist open-close test: mean fingertip-to-wrist aperture cycles. */
export function computeFistMetrics(frames: LandmarkFrame[]): CycleAnalysis {
  return analyzeCycleTest(frames, FIST_PARAMS)
}
