// Per-test configuration consumed by the record and results screens.

import {
  FIST_FC_HZ,
  FIST_LIVE_Y_RANGE,
  FIST_TEST_MS,
  TAP_FC_HZ,
  TAP_LIVE_Y_RANGE,
  TAP_TEST_MS,
} from '../config'
import { computeFistMetrics } from '../metrics/fist'
import { apertureRaw, tapRaw } from '../metrics/kinematics'
import { computeTapMetrics } from '../metrics/taps'
import type { CycleAnalysis, LandmarkFrame, TestId, Vec3 } from '../types'

export interface TestDefinition {
  id: TestId
  title: string
  description: string
  instructions: string
  durationMs: number
  eventNoun: [singular: string, plural: string]
  signalLabel: string
  closingLabel: string
  openingLabel: string
  liveYRange: readonly [number, number]
  fcHz: number
  /** Landmark indices emphasized on the skeleton overlay during the test. */
  highlightLandmarks: readonly number[]
  /** Raw movement signal from world landmarks, meters. */
  rawSignal(world: Vec3[]): number
  compute(frames: LandmarkFrame[]): CycleAnalysis
}

export const FINGER_TAP: TestDefinition = {
  id: 'finger_tap',
  title: 'Finger Tapping Test',
  description:
    'Tap the tip of your index finger against the tip of your thumb as big and as fast as you can.',
  instructions:
    'Hold your hand up facing the camera, fingers relaxed and visible. Tap thumb and index finger together as wide and fast as possible until the timer ends.',
  durationMs: TAP_TEST_MS,
  eventNoun: ['tap', 'taps'],
  signalLabel: 'Thumb–index separation (hand units)',
  closingLabel: 'Closing speed',
  openingLabel: 'Opening speed',
  liveYRange: TAP_LIVE_Y_RANGE,
  fcHz: TAP_FC_HZ,
  highlightLandmarks: [4, 8],
  rawSignal: tapRaw,
  compute: computeTapMetrics,
}

export const FIST_OPEN_CLOSE: TestDefinition = {
  id: 'fist_open_close',
  title: 'Fist Open–Close Test',
  description:
    'Open your hand fully, then clench it into a fist, repeating as fast and as completely as you can.',
  instructions:
    'Face your palm to the camera. Open the hand fully, then close it into a tight fist, repeating until the timer ends.',
  durationMs: FIST_TEST_MS,
  eventNoun: ['cycle', 'cycles'],
  signalLabel: 'Hand aperture (hand units)',
  closingLabel: 'Clench speed',
  openingLabel: 'Opening speed',
  liveYRange: FIST_LIVE_Y_RANGE,
  fcHz: FIST_FC_HZ,
  highlightLandmarks: [0, 8, 12, 16, 20],
  rawSignal: apertureRaw,
  compute: computeFistMetrics,
}

export const TEST_DEFS: TestDefinition[] = [FINGER_TAP, FIST_OPEN_CLOSE]

export function testDefById(id: string): TestDefinition | null {
  return TEST_DEFS.find((d) => d.id === id) ?? null
}
