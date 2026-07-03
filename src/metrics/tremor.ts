// Postural / rest tremor (family 'tremor'): whole-hand displacement from the
// IMAGE-space hand centroid — world landmarks are hand-centered, so
// whole-hand translation is invisible in them. The centroid path is split at
// tracking gaps, resampled to a uniform grid, linearly detrended per run
// (removing position offset and slow drift so per-frame scale noise cannot
// masquerade as displacement), converted to cm via a least-squares in-plane
// world→image scale fit over all 21 landmarks (foreshortening-robust — see
// fitCmPerImageUnit; a single projected segment would inflate cm several-
// fold in the arm-extended-toward-camera posture), and Welch-analyzed per
// axis.
//
// The REST test adds a third channel: the thumb-tip↔index-tip WORLD distance
// (already metric → cm directly, rotation-invariant, no image scale needed).
// Rest tremor is classically pill-rolling — rhythmic thumb–finger motion the
// palm centroid deliberately cannot see (it excludes fingers so voluntary
// finger movement can't fake whole-hand tremor in the postural test) — so
// without this channel a textbook rest tremor would read as "no tremor".

import {
  MAX_GAP_MS,
  TREMOR_BAND_HZ,
  TREMOR_LOW_CONFIDENCE_INDEX_PCT,
  TREMOR_PSD_SEGMENT_SAMPLES,
  TREMOR_RESAMPLE_HZ,
  TREMOR_TOTAL_BAND_HZ,
} from '../config'
import {
  bandPower,
  detrendLinear,
  dominantFrequency,
  resampleUniform,
  welchPsd,
  type Psd,
} from '../signal/spectrum'
import { mean } from '../signal/stats'
import type { LandmarkFrame, Series, TremorAnalysis, TremorMetrics } from '../types'
import { computeFrameQuality } from './cycleTest'
import { fitCmPerImageUnit, rawHandScale, tapRaw, worldHandScale } from './kinematics'

/** Wrist + the four finger MCPs — a rigid-ish palm centroid that clenching
 *  or tapping fingers barely move, so voluntary finger motion cannot fake
 *  whole-hand tremor. */
export const TREMOR_CENTROID_LANDMARKS = [0, 5, 9, 13, 17] as const

const EMPTY_METRICS: TremorMetrics = {
  dominantFreqHz: null,
  bandPowerCm2: null,
  tremorIndexPct: null,
  rmsAmplitudeCm: null,
  peakAmplitudeCm: null,
  axisSharePct: null,
  sampleCount: 0,
}

/** No discernible tremor peak (or no analyzable signal at all) — results
 *  views show a low-confidence banner instead of asserting a frequency. */
export function isLowConfidenceTremor(m: TremorMetrics): boolean {
  return (
    m.tremorIndexPct === null ||
    m.tremorIndexPct < TREMOR_LOW_CONFIDENCE_INDEX_PCT ||
    m.dominantFreqHz === null
  )
}

/** Sums two PSDs on the identical frequency grid. */
function addPsd(a: Psd | null, b: Psd): Psd {
  if (a === null) return { freqHz: [...b.freqHz], power: [...b.power] }
  return { freqHz: a.freqHz, power: a.power.map((p, i) => p + b.power[i]!) }
}

export interface TremorComputeOpts {
  /** Analyze the thumb-tip↔index-tip world distance (cm) as a third channel
   *  alongside the centroid axes — the rest test's pill-rolling component,
   *  which is invisible to the finger-free palm centroid. */
  fingerChannel?: boolean
}

export function computeTremorMetrics(
  frames: LandmarkFrame[],
  opts: TremorComputeOpts = {},
): TremorAnalysis {
  const withFinger = opts.fingerChannel === true
  // Detected-frame filter matching the other families' extractors.
  const t: number[] = []
  const cx: number[] = []
  const cy: number[] = []
  const cf: number[] = []
  const rawScales: number[] = []
  const cmPerImageUnit: number[] = []
  for (const f of frames) {
    if (!f.landmarks || !f.world) continue
    const ws = worldHandScale(f.world)
    if (ws < 1e-6) continue
    const rs = rawHandScale(f.landmarks, f.aspect)
    if (rs < 1e-9) continue
    // In-plane least-squares world→image fit → cm per image unit, per frame.
    const cm = fitCmPerImageUnit(f.landmarks, f.world, f.aspect)
    if (cm === null) continue
    rawScales.push(rs)
    cmPerImageUnit.push(cm)
    let x = 0
    let y = 0
    for (const i of TREMOR_CENTROID_LANDMARKS) {
      x += f.landmarks[i]!.x * f.aspect
      y += f.landmarks[i]!.y
    }
    t.push(f.t)
    cx.push(x / TREMOR_CENTROID_LANDMARKS.length)
    cy.push(y / TREMOR_CENTROID_LANDMARKS.length)
    if (withFinger) cf.push(tapRaw(f.world) * 100)
  }
  const sampleCount = t.length

  // Split into contiguous runs at tracking gaps.
  const runs: Array<[number, number]> = []
  let start = 0
  for (let i = 1; i <= sampleCount; i++) {
    if (i === sampleCount || t[i]! - t[i - 1]! > MAX_GAP_MS) {
      if (i - start >= 2) runs.push([start, i])
      start = i
    }
  }

  // Scale factor: mean over all detected frames. Applying a per-frame factor
  // to an absolute position would inject scale noise proportional to the
  // (large) centroid coordinate; detrend-then-scale keeps the error
  // proportional to the (small) tremor amplitude instead.
  const cmScale = cmPerImageUnit.length > 0 ? mean(cmPerImageUnit) : 0

  const dispX: Series = { t: [], v: [] }
  const dispY: Series = { t: [], v: [] }
  const dispF: Series = { t: [], v: [] }
  let psdX: Psd | null = null
  let psdY: Psd | null = null
  let psdF: Psd | null = null
  let psdSamples = 0
  let fallback: { x: Psd; y: Psd; f: Psd | null; samples: number } | null = null
  let peakAbs = 0
  const dt = 1000 / TREMOR_RESAMPLE_HZ

  for (const [a, b] of runs) {
    const runT = t.slice(a, b)
    const rx = detrendLinear(resampleUniform({ t: runT, v: cx.slice(a, b) }, TREMOR_RESAMPLE_HZ))
    const ry = detrendLinear(resampleUniform({ t: runT, v: cy.slice(a, b) }, TREMOR_RESAMPLE_HZ))
    // Finger separation is already metric (cm) — no cmScale multiplication.
    const rf = withFinger
      ? detrendLinear(resampleUniform({ t: runT, v: cf.slice(a, b) }, TREMOR_RESAMPLE_HZ))
      : null
    for (let i = 0; i < rx.length; i++) {
      const time = runT[0]! + i * dt
      const vx = rx[i]! * cmScale
      const vy = ry[i]! * cmScale
      dispX.t.push(time)
      dispX.v.push(vx)
      dispY.t.push(time)
      dispY.v.push(vy)
      let abs = Math.max(Math.abs(vx), Math.abs(vy))
      if (rf !== null) {
        const vf = rf[i]!
        dispF.t.push(time)
        dispF.v.push(vf)
        abs = Math.max(abs, Math.abs(vf))
      }
      if (abs > peakAbs) peakAbs = abs
    }
    // Welch per run. Runs shorter than the fixed segment length would land
    // on a different frequency grid, so they only serve as a fallback when
    // no run is long enough for the canonical grid.
    if (rx.length >= TREMOR_PSD_SEGMENT_SAMPLES) {
      const px = welchPsd(rx.map((v) => v * cmScale), TREMOR_RESAMPLE_HZ, {
        segLen: TREMOR_PSD_SEGMENT_SAMPLES,
      })
      const py = welchPsd(ry.map((v) => v * cmScale), TREMOR_RESAMPLE_HZ, {
        segLen: TREMOR_PSD_SEGMENT_SAMPLES,
      })
      // Weight by run length: longer runs contribute proportionally.
      psdX = addPsd(psdX, { freqHz: px.freqHz, power: px.power.map((p) => p * rx.length) })
      psdY = addPsd(psdY, { freqHz: py.freqHz, power: py.power.map((p) => p * rx.length) })
      if (rf !== null) {
        const pf = welchPsd(rf, TREMOR_RESAMPLE_HZ, { segLen: TREMOR_PSD_SEGMENT_SAMPLES })
        psdF = addPsd(psdF, { freqHz: pf.freqHz, power: pf.power.map((p) => p * rx.length) })
      }
      psdSamples += rx.length
    } else if (rx.length >= 32 && (fallback === null || rx.length > fallback.samples)) {
      const px = welchPsd(rx.map((v) => v * cmScale), TREMOR_RESAMPLE_HZ)
      const py = welchPsd(ry.map((v) => v * cmScale), TREMOR_RESAMPLE_HZ)
      const pf = rf !== null ? welchPsd(rf, TREMOR_RESAMPLE_HZ) : null
      if (px.freqHz.length > 0) fallback = { x: px, y: py, f: pf, samples: rx.length }
    }
  }

  let finalX: Psd | null = null
  let finalY: Psd | null = null
  let finalF: Psd | null = null
  if (psdX !== null && psdY !== null && psdSamples > 0) {
    finalX = { freqHz: psdX.freqHz, power: psdX.power.map((p) => p / psdSamples) }
    finalY = { freqHz: psdY.freqHz, power: psdY.power.map((p) => p / psdSamples) }
    if (psdF !== null) {
      finalF = { freqHz: psdF.freqHz, power: psdF.power.map((p) => p / psdSamples) }
    }
  } else if (fallback !== null) {
    finalX = fallback.x
    finalY = fallback.y
    finalF = fallback.f
  }

  const droppedIntervals = Math.max(0, runs.length - 1)
  const quality = computeFrameQuality(frames, rawScales, droppedIntervals)

  if (finalX === null || finalY === null) {
    return {
      metrics: { ...EMPTY_METRICS, sampleCount },
      signal: dispX,
      events: [],
      displacement: { x: dispX, y: dispY },
      psd: { freqHz: [], power: [] },
      quality,
    }
  }

  let combined = addPsd(finalX, finalY)
  if (finalF !== null) combined = addPsd(combined, finalF)
  const [bandLo, bandHi] = TREMOR_BAND_HZ
  const [totalLo, totalHi] = TREMOR_TOTAL_BAND_HZ
  const bandX = bandPower(finalX, bandLo, bandHi)
  const bandY = bandPower(finalY, bandLo, bandHi)
  const bandF = finalF !== null ? bandPower(finalF, bandLo, bandHi) : 0
  const band = bandX + bandY + bandF
  const transBand = bandX + bandY
  const total = bandPower(combined, totalLo, totalHi)
  const dominant = dominantFrequency(combined, bandLo, bandHi)

  const metrics: TremorMetrics = {
    dominantFreqHz: dominant?.freqHz ?? null,
    bandPowerCm2: band,
    tremorIndexPct: total > 0 ? (100 * band) / total : null,
    rmsAmplitudeCm: Math.sqrt(band),
    peakAmplitudeCm: peakAbs,
    axisSharePct:
      transBand > 0
        ? { x: (100 * bandX) / transBand, y: (100 * bandY) / transBand }
        : null,
    sampleCount,
  }

  // Dominant channel (by in-band power) becomes the headline trace.
  const signal =
    bandF > bandX && bandF > bandY ? dispF : bandX >= bandY ? dispX : dispY

  return {
    metrics,
    signal,
    events: [],
    displacement: { x: dispX, y: dispY },
    psd: combined,
    quality,
  }
}
