// Full offline analysis pipeline for a timed cycle test recording:
// frames → normalized signal → per-segment zero-phase smoothing →
// adaptive peak detection → cycle events → aggregate metrics.

import { MAX_GAP_MS, PROM_RANGE_FACTOR } from '../config'
import { centralDiff, smoothZeroPhase } from '../signal/filters'
import { cvPct, mean, percentile } from '../signal/stats'
import type {
  CycleAnalysis,
  CycleEvent,
  CycleTestMetrics,
  LandmarkFrame,
  QualityMetrics,
  Series,
} from '../types'
import { extractCycles } from './cycles'
import { computeDecrement } from './decrement'
import { splitSeries, type ExtractedSignal } from './kinematics'
import { computeRhythm } from './rhythm'

export interface CycleTestParams {
  /** frames → normalized signal series. Tap/fist wrap the hand-unit
   *  extractSignal; angle tests (pronation-supination) supply their own
   *  degree-valued extractor with cmPerUnit null. */
  extract: (frames: LandmarkFrame[]) => ExtractedSignal
  fcHz: number
  promFloor: number
  minDistanceMs: number
  hesitationAbsMs: number
}

export function analyzeCycleTest(frames: LandmarkFrame[], p: CycleTestParams): CycleAnalysis {
  const { series, rawScales, cmPerUnit } = p.extract(frames)
  const segments = splitSeries(series, MAX_GAP_MS)
  const smooth = segments.map((seg) => ({
    t: seg.t,
    v: smoothZeroPhase(seg.t, seg.v, p.fcHz),
  }))

  // Adaptive prominence from the robust range of the whole smoothed signal.
  const allV = smooth.flatMap((s) => s.v)
  const range = percentile(allV, 90) - percentile(allV, 10)
  const opts = {
    minProminence: Math.max(p.promFloor, PROM_RANGE_FACTOR * (Number.isFinite(range) ? range : 0)),
    minDistanceMs: p.minDistanceMs,
  }

  const events: CycleEvent[] = []
  smooth.forEach((seg, si) => {
    if (seg.t.length < 3) return
    events.push(...extractCycles(seg.t, seg.v, centralDiff(seg.t, seg.v), opts, si))
  })

  const signal: Series = {
    t: smooth.flatMap((s) => s.t),
    v: smooth.flatMap((s) => s.v),
  }
  return {
    metrics: aggregate(events, p.hesitationAbsMs, cmPerUnit),
    signal,
    events,
    quality: computeQuality(frames, rawScales, events),
  }
}

function aggregate(
  events: CycleEvent[],
  hesitationAbsMs: number,
  cmPerUnit: number | null,
): CycleTestMetrics {
  const count = events.length
  const amps = events.map((e) => e.closingAmplitude)
  const closingVels = events.map((e) => e.peakClosingVel)
  const openingVels = events
    .map((e) => e.peakOpeningVel)
    .filter((x): x is number => x !== null)

  const first = events[0]
  const last = events[count - 1]
  const frequencyHz =
    count >= 2 && last!.tMs > first!.tMs ? ((count - 1) / (last!.tMs - first!.tMs)) * 1000 : null

  const amplitudeMean = count > 0 ? mean(amps) : null
  const closingVelPeak = count > 0 ? Math.max(...closingVels) : null
  return {
    count,
    frequencyHz,
    amplitudeMean,
    amplitudeMax: count > 0 ? Math.max(...amps) : null,
    amplitudeMeanCm: amplitudeMean !== null && cmPerUnit !== null ? amplitudeMean * cmPerUnit : null,
    closingVelMean: count > 0 ? mean(closingVels) : null,
    closingVelPeak,
    closingVelPeakCmS:
      closingVelPeak !== null && cmPerUnit !== null ? closingVelPeak * cmPerUnit : null,
    openingVelMean: openingVels.length > 0 ? mean(openingVels) : null,
    openingVelPeak: openingVels.length > 0 ? Math.max(...openingVels) : null,
    amplitudeDecrement: computeDecrement(amps),
    velocityDecrement: computeDecrement(closingVels),
    rhythm: computeRhythm(events, hesitationAbsMs),
    cmPerUnit,
  }
}

function computeQuality(
  frames: LandmarkFrame[],
  rawScales: number[],
  events: CycleEvent[],
): QualityMetrics {
  const n = frames.length
  const span = n >= 2 ? frames[n - 1]!.t - frames[0]!.t : 0
  const detected = frames.reduce((acc, f) => acc + (f.landmarks ? 1 : 0), 0)
  const scaleCv = cvPct(rawScales)
  let dropped = 0
  for (let i = 1; i < events.length; i++) {
    if (events[i]!.segment !== events[i - 1]!.segment) dropped++
  }
  return {
    meanFps: span > 0 ? ((n - 1) / span) * 1000 : 0,
    detectionRate: n > 0 ? detected / n : 0,
    droppedIntervals: dropped,
    handScaleCvPct: Number.isFinite(scaleCv) ? scaleCv : 0,
  }
}
