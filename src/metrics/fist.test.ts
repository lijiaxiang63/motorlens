import { describe, expect, it } from 'vitest'
import { makeFistFrames } from '../replay/synthetic'
import { computeFistMetrics } from './fist'

describe('computeFistMetrics on synthetic ground truth', () => {
  it('recovers count, frequency, and aperture amplitude at 1.5 Hz', () => {
    const { frames, truth } = makeFistFrames({ freqHz: 1.5 })
    const { metrics } = computeFistMetrics(frames)

    expect(Math.abs(metrics.count - truth.count)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.frequencyHz! - 1.5)).toBeLessThan(0.05)
    // True aperture amplitude 2.2 − 0.9 = 1.3 hand units, minus smoothing.
    expect(metrics.amplitudeMean).toBeGreaterThan(1.0)
    expect(metrics.amplitudeMean).toBeLessThan(1.4)
    // Clench speed: raised-cosine peak = π·amp·freq ≈ 6.1 units/s.
    expect(metrics.closingVelMean).toBeGreaterThan(0.6 * Math.PI * 1.3 * 1.5)
    expect(metrics.closingVelMean).toBeLessThan(1.1 * Math.PI * 1.3 * 1.5)
    expect(metrics.openingVelMean).toBeGreaterThan(0.6 * Math.PI * 1.3 * 1.5)
    expect(metrics.rhythm.hesitationCount).toBe(0)
  })

  it('measures fist amplitude decrement', () => {
    const { frames } = makeFistFrames({ freqHz: 1.5, decrementPct: 25 })
    const { metrics } = computeFistMetrics(frames)
    expect(Math.abs(metrics.amplitudeDecrement.regressionPct! - 25)).toBeLessThan(5)
  })
})
