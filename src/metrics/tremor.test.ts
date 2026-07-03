import { describe, expect, it } from 'vitest'
import { makeTremorFrames } from '../replay/synthetic'
import { computeTremorMetrics, isLowConfidenceTremor } from './tremor'

describe('computeTremorMetrics on synthetic ground truth', () => {
  it('recovers a 5 Hz / 0.8 cm tremor end-to-end', () => {
    const { frames, truth } = makeTremorFrames({ freqHz: 5, ampCm: 0.8 })
    const { metrics, quality, psd, displacement } = computeTremorMetrics(frames)

    expect(metrics.dominantFreqHz).not.toBeNull()
    expect(Math.abs(metrics.dominantFreqHz! - 5)).toBeLessThan(0.2)
    // RMS of a pure sinusoid = amp/√2 ≈ 0.566 cm; ±15%.
    expect(metrics.rmsAmplitudeCm).not.toBeNull()
    expect(Math.abs(metrics.rmsAmplitudeCm! - truth.rmsCm) / truth.rmsCm).toBeLessThan(0.15)
    expect(metrics.peakAmplitudeCm).not.toBeNull()
    expect(metrics.peakAmplitudeCm!).toBeGreaterThan(0.5)
    // A pure tone concentrates its power inside the band.
    expect(metrics.tremorIndexPct).not.toBeNull()
    expect(metrics.tremorIndexPct!).toBeGreaterThan(60)
    expect(isLowConfidenceTremor(metrics)).toBe(false)
    // Axis shares reflect the 25° oscillation direction and sum to 100.
    expect(metrics.axisSharePct).not.toBeNull()
    expect(metrics.axisSharePct!.x + metrics.axisSharePct!.y).toBeCloseTo(100, 6)
    expect(metrics.axisSharePct!.x).toBeGreaterThan(metrics.axisSharePct!.y)
    expect(metrics.sampleCount).toBe(450)
    expect(quality.detectionRate).toBe(1)
    expect(psd.freqHz.length).toBeGreaterThan(0)
    expect(displacement.x.t).toHaveLength(displacement.y.t.length)
  })

  it('recovers amplitude with the arm extended toward the camera (foreshortened hand)', () => {
    // The clinical postural-tremor posture: arm out in front, palm down,
    // subject facing the camera. The projected wrist→middle-MCP segment is
    // ~3× foreshortened here; the old segment-ratio cm conversion inflated
    // every amplitude metric by the same factor (rms ≈ 1.65 instead of 0.57).
    const { frames, truth } = makeTremorFrames({ posture: 'forward', freqHz: 5, ampCm: 0.8 })
    const { metrics } = computeTremorMetrics(frames)

    expect(metrics.dominantFreqHz).not.toBeNull()
    expect(Math.abs(metrics.dominantFreqHz! - 5)).toBeLessThan(0.2)
    expect(metrics.rmsAmplitudeCm).not.toBeNull()
    expect(Math.abs(metrics.rmsAmplitudeCm! - truth.rmsCm) / truth.rmsCm).toBeLessThan(0.15)
    expect(metrics.peakAmplitudeCm!).toBeGreaterThan(0.5)
    expect(metrics.peakAmplitudeCm!).toBeLessThan(1.2)
    expect(isLowConfidenceTremor(metrics)).toBe(false)
  })

  it('rest channel: detects pill-rolling finger tremor the palm centroid is blind to', () => {
    // Pure pill-rolling: thumb–index separation oscillates at 5 Hz while the
    // palm centroid only drifts slowly (plus a little landmark noise) — a
    // realistic resting hand. The centroid-only analysis must NOT see the
    // tremor (that blindness protects the postural test from voluntary
    // finger motion); the rest test's finger channel must.
    const { frames } = makeTremorFrames({
      ampCm: 0,
      finger: { freqHz: 5, ampCm: 0.5 },
      drift: { freqHz: 0.8, ampCm: 0.4 },
      noiseSdCm: 0.02,
      seed: 4,
    })

    const centroidOnly = computeTremorMetrics(frames)
    expect(isLowConfidenceTremor(centroidOnly.metrics)).toBe(true)

    const rest = computeTremorMetrics(frames, { fingerChannel: true })
    expect(rest.metrics.dominantFreqHz).not.toBeNull()
    expect(Math.abs(rest.metrics.dominantFreqHz! - 5)).toBeLessThan(0.2)
    const expectedRms = 0.5 / Math.SQRT2
    expect(Math.abs(rest.metrics.rmsAmplitudeCm! - expectedRms) / expectedRms).toBeLessThan(0.15)
    expect(isLowConfidenceTremor(rest.metrics)).toBe(false)
    // The headline trace is the dominant channel — here the finger signal.
    expect(Math.max(...rest.signal.v.map(Math.abs))).toBeGreaterThan(0.3)
  })

  it('rest channel: combines translation and pill-rolling power', () => {
    const { frames, truth } = makeTremorFrames({
      freqHz: 5,
      ampCm: 0.6,
      finger: { freqHz: 5, ampCm: 0.4 },
    })
    const { metrics } = computeTremorMetrics(frames, { fingerChannel: true })
    // truth.rmsCm covers both tones (√(0.6²/2 + 0.4²/2) ≈ 0.51 cm).
    expect(Math.abs(metrics.rmsAmplitudeCm! - truth.rmsCm) / truth.rmsCm).toBeLessThan(0.15)
    // Axis share still describes the translation split only and sums to 100.
    expect(metrics.axisSharePct).not.toBeNull()
    expect(metrics.axisSharePct!.x + metrics.axisSharePct!.y).toBeCloseTo(100, 6)
  })

  it('does not flag a tremor-free hand (slow postural drift only)', () => {
    const { frames } = makeTremorFrames({
      ampCm: 0,
      drift: { freqHz: 0.8, ampCm: 0.4 },
      noiseSdCm: 0.02,
      seed: 3,
    })
    const { metrics } = computeTremorMetrics(frames)
    expect(metrics.tremorIndexPct).not.toBeNull()
    expect(metrics.tremorIndexPct!).toBeLessThan(20)
    expect(isLowConfidenceTremor(metrics)).toBe(true)
  })

  it('resolves a two-tone 4+8 Hz tremor with the dominant at 4 Hz', () => {
    const { frames } = makeTremorFrames({
      freqHz: 4,
      ampCm: 0.8,
      secondary: { freqHz: 8, ampCm: 0.45 },
    })
    const { metrics, psd } = computeTremorMetrics(frames)
    expect(Math.abs(metrics.dominantFreqHz! - 4)).toBeLessThan(0.2)
    // The 8 Hz tone is clearly visible above the PSD floor.
    const at8 = psd.freqHz.reduce(
      (best, f, i) =>
        f >= 7.7 && f <= 8.3 && psd.power[i]! > best ? psd.power[i]! : best,
      0,
    )
    const sorted = [...psd.power].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    expect(at8).toBeGreaterThan(10 * median)
  })

  it('degrades through a mid-test dropout without aborting', () => {
    const { frames, truth } = makeTremorFrames({
      freqHz: 5,
      ampCm: 0.8,
      dropouts: [{ atMs: 7000, durMs: 600 }],
    })
    const { metrics, quality } = computeTremorMetrics(frames)
    expect(metrics.dominantFreqHz).not.toBeNull()
    expect(Math.abs(metrics.dominantFreqHz! - 5)).toBeLessThan(0.2)
    expect(metrics.rmsAmplitudeCm).not.toBeNull()
    expect(Math.abs(metrics.rmsAmplitudeCm! - truth.rmsCm) / truth.rmsCm).toBeLessThan(0.15)
    expect(metrics.tremorIndexPct).not.toBeNull()
    expect(quality.detectionRate).toBeLessThan(1)
    expect(quality.droppedIntervals).toBe(1)
  })

  it('returns nulls, not NaNs, for an empty recording', () => {
    const { metrics, quality, psd, signal } = computeTremorMetrics([])
    expect(metrics.dominantFreqHz).toBeNull()
    expect(metrics.rmsAmplitudeCm).toBeNull()
    expect(metrics.tremorIndexPct).toBeNull()
    expect(metrics.axisSharePct).toBeNull()
    expect(metrics.sampleCount).toBe(0)
    expect(isLowConfidenceTremor(metrics)).toBe(true)
    expect(psd.freqHz).toHaveLength(0)
    expect(signal.t).toHaveLength(0)
    expect(quality.detectionRate).toBe(0)
  })
})
