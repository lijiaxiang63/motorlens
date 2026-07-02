import { describe, expect, it } from 'vitest'
import { centralDiff, emaForward, smoothZeroPhase } from './filters'

function times(n: number, fps: number): number[] {
  return Array.from({ length: n }, (_, i) => (i * 1000) / fps)
}

describe('smoothZeroPhase', () => {
  it('introduces no time shift on a pulse', () => {
    const t = times(201, 100)
    const v = t.map((ms) => Math.exp(-((ms - 1000) ** 2) / (2 * 50 ** 2)))
    const s = smoothZeroPhase(t, v, 5)
    const peakIdx = s.indexOf(Math.max(...s))
    expect(Math.abs(t[peakIdx]! - 1000)).toBeLessThanOrEqual(10)
  })

  it('shifts the peak later when filtering forward-only (sanity contrast)', () => {
    const t = times(201, 100)
    const v = t.map((ms) => Math.exp(-((ms - 1000) ** 2) / (2 * 50 ** 2)))
    const s = emaForward(t, v, 3)
    const peakIdx = s.indexOf(Math.max(...s))
    expect(t[peakIdx]!).toBeGreaterThan(1010)
  })

  it('preserves a 1 Hz component and attenuates 15 Hz', () => {
    const t = times(600, 120)
    const slow = t.map((ms) => Math.sin((2 * Math.PI * ms) / 1000))
    const fast = t.map((ms) => Math.sin((2 * Math.PI * 15 * ms) / 1000))
    const sSlow = smoothZeroPhase(t, slow, 6)
    const sFast = smoothZeroPhase(t, fast, 6)
    // Compare amplitudes over the steady middle section
    const amp = (v: number[]) => Math.max(...v.slice(100, 500)) - Math.min(...v.slice(100, 500))
    expect(amp(sSlow)).toBeGreaterThan(amp(slow.slice(0)) * 0.95)
    expect(amp(sFast)).toBeLessThan(amp(fast.slice(0)) * 0.35)
  })

  it('handles empty and single-sample input', () => {
    expect(smoothZeroPhase([], [], 5)).toEqual([])
    expect(smoothZeroPhase([0], [3], 5)).toEqual([3])
  })
})

describe('centralDiff', () => {
  it('differentiates a linear ramp exactly', () => {
    const t = times(50, 100)
    const v = t.map((ms) => 2 * (ms / 1000)) // slope 2 units/s
    const d = centralDiff(t, v)
    for (const x of d) expect(x).toBeCloseTo(2, 6)
  })

  it('matches the analytic derivative of a sine at interior points', () => {
    const t = times(200, 200)
    const f = 1.5
    const v = t.map((ms) => Math.sin((2 * Math.PI * f * ms) / 1000))
    const d = centralDiff(t, v)
    const expected = t.map((ms) => 2 * Math.PI * f * Math.cos((2 * Math.PI * f * ms) / 1000))
    for (let i = 5; i < 195; i++) {
      expect(Math.abs(d[i]! - expected[i]!)).toBeLessThan(0.05 * 2 * Math.PI * f)
    }
  })
})
