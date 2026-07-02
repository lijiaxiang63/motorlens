import { describe, expect, it } from 'vitest'
import { makeTapFrames } from '../replay/synthetic'
import { cvPct } from '../signal/stats'
import { computeTapMetrics } from './taps'

describe('computeTapMetrics on synthetic ground truth', () => {
  it('recovers count, frequency, and amplitude of steady 2 Hz tapping', () => {
    const { frames, truth } = makeTapFrames({ freqHz: 2 })
    const { metrics, quality } = computeTapMetrics(frames)

    expect(Math.abs(metrics.count - truth.count)).toBeLessThanOrEqual(1)
    expect(metrics.frequencyHz).not.toBeNull()
    expect(Math.abs(metrics.frequencyHz! - 2)).toBeLessThan(0.05)
    // True amplitude 0.9 hand units; smoothing attenuates a bit.
    expect(metrics.amplitudeMean).toBeGreaterThan(0.7)
    expect(metrics.amplitudeMean).toBeLessThan(0.95)
    // Template hand: 1 hand unit = 8 cm.
    expect(metrics.cmPerUnit).toBeCloseTo(8, 1)
    expect(metrics.amplitudeMeanCm).toBeCloseTo(metrics.amplitudeMean! * 8, 3)
    // Raised-cosine peak closing speed = π·amp·freq ≈ 5.65 units/s.
    expect(metrics.closingVelMean).toBeGreaterThan(0.6 * Math.PI * 0.9 * 2)
    expect(metrics.closingVelMean).toBeLessThan(1.1 * Math.PI * 0.9 * 2)
    // Steady tapping: no decrement, tight rhythm, no hesitation.
    expect(Math.abs(metrics.amplitudeDecrement.regressionPct ?? 99)).toBeLessThan(5)
    expect(metrics.rhythm.itiCvPct).not.toBeNull()
    expect(metrics.rhythm.itiCvPct!).toBeLessThan(5)
    expect(metrics.rhythm.hesitationCount).toBe(0)
    expect(quality.detectionRate).toBe(1)
    expect(quality.meanFps).toBeCloseTo(30, 0)
  })

  it('works with noise at a higher rate', () => {
    const { frames, truth } = makeTapFrames({ freqHz: 3.5, noiseSd: 0.03, seed: 5 })
    const { metrics } = computeTapMetrics(frames)
    expect(Math.abs(metrics.count - truth.count)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.frequencyHz! - 3.5)).toBeLessThan(0.1)
  })

  it('measures injected amplitude decrement', () => {
    const { frames } = makeTapFrames({ decrementPct: 30 })
    const { metrics } = computeTapMetrics(frames)
    expect(metrics.amplitudeDecrement.regressionPct).not.toBeNull()
    expect(Math.abs(metrics.amplitudeDecrement.regressionPct! - 30)).toBeLessThan(5)
    expect(metrics.amplitudeDecrement.thirdsPct).not.toBeNull()
    expect(metrics.amplitudeDecrement.thirdsPct!).toBeGreaterThan(10)
  })

  it('measures rhythm variability close to the generated CV', () => {
    const { frames, truth } = makeTapFrames({ itiJitterPct: 15, seed: 11 })
    const { metrics } = computeTapMetrics(frames)
    const truthCv = cvPct(truth.itis)
    expect(metrics.rhythm.itiCvPct).not.toBeNull()
    expect(Math.abs(metrics.rhythm.itiCvPct! - truthCv)).toBeLessThan(3)
  })

  it('detects an injected hesitation', () => {
    const { frames } = makeTapFrames({ hesitations: [{ atMs: 5000, extraMs: 900 }] })
    const { metrics } = computeTapMetrics(frames)
    expect(metrics.rhythm.hesitationCount).toBeGreaterThanOrEqual(1)
    expect(metrics.rhythm.longestPauseMs).not.toBeNull()
    expect(Math.abs(metrics.rhythm.longestPauseMs! - 1400)).toBeLessThan(100)
  })

  it('splits segments on dropout without phantom events', () => {
    const { frames, truth } = makeTapFrames({ dropouts: [{ atMs: 4000, durMs: 600 }] })
    const { metrics, quality, events } = computeTapMetrics(frames)
    // Lose at most the couple of closures inside/adjacent to the dropout.
    expect(metrics.count).toBeGreaterThanOrEqual(truth.count - 3)
    expect(metrics.count).toBeLessThanOrEqual(truth.count)
    expect(metrics.rhythm.droppedIntervals).toBe(1)
    expect(quality.detectionRate).toBeLessThan(1)
    expect(new Set(events.map((e) => e.segment)).size).toBe(2)
  })

  it('returns nulls, not NaNs, for an empty recording', () => {
    const { metrics, quality } = computeTapMetrics([])
    expect(metrics.count).toBe(0)
    expect(metrics.frequencyHz).toBeNull()
    expect(metrics.amplitudeMean).toBeNull()
    expect(metrics.amplitudeDecrement.regressionPct).toBeNull()
    expect(quality.detectionRate).toBe(0)
  })
})
