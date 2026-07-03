import { describe, expect, it } from 'vitest'
import { makePronosupFrames, SYNTH_ASPECT } from '../replay/synthetic'
import type { LandmarkFrame } from '../types'
import { computePronosupMetrics, rollDeg } from './pronosup'

/** Rigidly pitch the hand about the wrist (palm tilting toward/away from the
 *  camera) ON TOP of the generated rotation, re-projecting the image
 *  landmarks — mirrors taps.test.ts's projection-invariance test. */
function pitchWobble(frames: LandmarkFrame[], maxDeg: number, freqHz: number): LandmarkFrame[] {
  return frames.map((f) => {
    if (!f.world) return f
    const th = ((maxDeg * Math.PI) / 180) * Math.sin((2 * Math.PI * freqHz * f.t) / 1000)
    const world = f.world.map((p) => ({
      x: p.x,
      y: p.y * Math.cos(th) - p.z * Math.sin(th),
      z: p.y * Math.sin(th) + p.z * Math.cos(th),
    }))
    const landmarks = world.map((w) => ({
      x: 0.5 + w.x / SYNTH_ASPECT,
      y: 0.55 + w.y,
      z: w.z / SYNTH_ASPECT,
    }))
    return { ...f, world, landmarks }
  })
}

describe('computePronosupMetrics on synthetic ground truth', () => {
  it('recovers count, frequency, and amplitude of steady 1 Hz rotation, with no cm semantics', () => {
    // 10.5 s schedules exactly 10 closures (next would fall past the window)
    // and leaves the last one a full opening arc — a 10.0 s cut would slice
    // that arc to ~200 ms and legitimately drop the final event at the
    // window edge (movement continues past a real recording window too).
    const { frames, truth } = makePronosupFrames({ freqHz: 1, durationMs: 10_500 })
    const { metrics, quality } = computePronosupMetrics(frames)

    expect(truth.count).toBe(10)
    expect(metrics.count).toBe(truth.count)
    expect(metrics.frequencyHz).not.toBeNull()
    expect(Math.abs(metrics.frequencyHz! - 1)).toBeLessThan(0.05)
    // True amplitude 80°; zero-phase smoothing attenuates a little (±8% band).
    expect(metrics.amplitudeMean).toBeGreaterThan(80 * 0.92)
    expect(metrics.amplitudeMean).toBeLessThan(80 * 1.08)
    // Degrees have no cm equivalent — the whole cm family must be null.
    expect(metrics.cmPerUnit).toBeNull()
    expect(metrics.amplitudeMeanCm).toBeNull()
    expect(metrics.closingVelPeakCmS).toBeNull()
    // Raised-cosine peak roll speed = π·amp·freq ≈ 251 °/s.
    expect(metrics.closingVelMean).toBeGreaterThan(0.6 * Math.PI * 80 * 1)
    expect(metrics.closingVelMean).toBeLessThan(1.1 * Math.PI * 80 * 1)
    // Steady rotation: no decrement, tight rhythm, no hesitation.
    expect(Math.abs(metrics.amplitudeDecrement.regressionPct ?? 99)).toBeLessThan(5)
    expect(metrics.rhythm.itiCvPct).not.toBeNull()
    expect(metrics.rhythm.itiCvPct!).toBeLessThan(5)
    expect(metrics.rhythm.hesitationCount).toBe(0)
    expect(quality.detectionRate).toBe(1)
  })

  it('measures injected amplitude decrement', () => {
    const { frames } = makePronosupFrames({ freqHz: 1, decrementPct: 30 })
    const { metrics } = computePronosupMetrics(frames)
    expect(metrics.amplitudeDecrement.regressionPct).not.toBeNull()
    expect(Math.abs(metrics.amplitudeDecrement.regressionPct! - 30)).toBeLessThan(5)
  })

  it('is immune to palm pitch overlaid on the rotation', () => {
    const { frames, truth } = makePronosupFrames({ freqHz: 1 })
    const base = computePronosupMetrics(frames).metrics
    const { metrics } = computePronosupMetrics(pitchWobble(frames, 10, 0.7))

    expect(Math.abs(metrics.count - truth.count)).toBeLessThanOrEqual(1)
    expect(Math.abs(metrics.frequencyHz! - 1)).toBeLessThan(0.05)
    // Roll amplitude rides on the 3-D palm normal; ±10° of pitch distorts the
    // measured amplitude by well under 5% (mirrors the taps invariant).
    expect(Math.abs(metrics.amplitudeMean! - base.amplitudeMean!) / base.amplitudeMean!).toBeLessThan(
      0.05,
    )
  })

  it('unwraps a roll signal that crosses the ±180° boundary', () => {
    // rollOffsetDeg 100 puts the wrapped roll in [150, 230]° — every cycle
    // crosses +180 and jumps to −180 in atan2 terms.
    const { frames, truth } = makePronosupFrames({
      freqHz: 1,
      durationMs: 10_500,
      rollOffsetDeg: 100,
    })
    const wrappedRolls = frames.map((f) => rollDeg(f.world!))
    expect(Math.min(...wrappedRolls)).toBeLessThan(-100) // proof the raw signal wraps
    const { metrics } = computePronosupMetrics(frames)
    expect(metrics.count).toBe(truth.count)
    expect(metrics.amplitudeMean).toBeGreaterThan(80 * 0.92)
    expect(metrics.amplitudeMean).toBeLessThan(80 * 1.08)
  })

  it('splits segments on dropout without phantom events', () => {
    const { frames, truth } = makePronosupFrames({
      freqHz: 1,
      dropouts: [{ atMs: 4000, durMs: 600 }],
    })
    const { metrics, quality, events } = computePronosupMetrics(frames)
    expect(metrics.count).toBeGreaterThanOrEqual(truth.count - 3)
    expect(metrics.count).toBeLessThanOrEqual(truth.count)
    expect(metrics.rhythm.droppedIntervals).toBe(1)
    expect(quality.detectionRate).toBeLessThan(1)
    expect(new Set(events.map((e) => e.segment)).size).toBe(2)
  })

  it('returns nulls, not NaNs, for an empty recording', () => {
    const { metrics, quality } = computePronosupMetrics([])
    expect(metrics.count).toBe(0)
    expect(metrics.frequencyHz).toBeNull()
    expect(metrics.amplitudeMean).toBeNull()
    expect(metrics.cmPerUnit).toBeNull()
    expect(metrics.amplitudeDecrement.regressionPct).toBeNull()
    expect(quality.detectionRate).toBe(0)
  })
})
