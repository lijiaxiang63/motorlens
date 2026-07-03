// Per-test configuration consumed by the record and results screens.
//
// TestDefinition is a discriminated union on `family`: cycle tests (tap,
// fist, pronation-supination) share the cycle engine and CycleAnalysis;
// tremor and ROM tests get their own definition arms as they land. The
// union member types let screens switch layout by family while TEST_DEFS
// keeps driving every test-agnostic surface (home cards, battery checklist,
// subject reports) unchanged.

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

export type TestFamily = 'cycle' | 'tremor' | 'rom'

interface TestDefinitionBase {
  id: TestId
  title: string
  description: string
  instructions: string
  durationMs: number
  /** Landmark indices emphasized on the skeleton overlay during the test. */
  highlightLandmarks: readonly number[]
}

export interface CycleTestDefinition extends TestDefinitionBase {
  family: 'cycle'
  eventNoun: [singular: string, plural: string]
  signalLabel: string
  closingLabel: string
  openingLabel: string
  liveYRange: readonly [number, number]
  fcHz: number
  /** 'hand' = movement signal divided by hand scale (hand units — tap/fist);
   *  'degrees' = angle signal, no scale normalization (pronation-supination).
   *  Drives live-chart normalization, metric unit suffixes, and the CSV
   *  amplitude_unit column. */
  signalKind: 'hand' | 'degrees'
  /** Raw movement signal from world landmarks: meters for 'hand' signals,
   *  wrapped degrees for 'degrees' signals (live chart only — the offline
   *  pipeline unwraps via its own extractor). */
  rawSignal(world: Vec3[]): number
  compute(frames: LandmarkFrame[]): CycleAnalysis
}

export type TestDefinition = CycleTestDefinition

export const FINGER_TAP: TestDefinition = {
  id: 'finger_tap',
  family: 'cycle',
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
  signalKind: 'hand',
  highlightLandmarks: [4, 8],
  rawSignal: tapRaw,
  compute: computeTapMetrics,
}

export const FIST_OPEN_CLOSE: TestDefinition = {
  id: 'fist_open_close',
  family: 'cycle',
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
  signalKind: 'hand',
  highlightLandmarks: [0, 8, 12, 16, 20],
  rawSignal: apertureRaw,
  compute: computeFistMetrics,
}

export const TEST_DEFS: TestDefinition[] = [FINGER_TAP, FIST_OPEN_CLOSE]

export function testDefById(id: string): TestDefinition | null {
  return TEST_DEFS.find((d) => d.id === id) ?? null
}

/** Single source of family truth for stored/imported results. Returns null
 *  for joint_monitor and unknown test ids — preserving the codebase-wide
 *  "testDefById → null means no results screen / no cycle metrics" branch.
 *  Every metrics-shape discrimination routes through this (no duck typing
 *  on metric fields). */
export function familyOfTest(testId: string): TestFamily | null {
  return testDefById(testId)?.family ?? null
}
