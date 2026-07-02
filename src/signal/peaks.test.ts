import { describe, expect, it } from 'vitest'
import { findPeaks, findValleys } from './peaks'

/** Deterministic pseudo-noise (mulberry32). */
function noise(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 2
  }
}

function sine(freqHz: number, durationMs: number, fps: number, noiseAmp = 0, seed = 1) {
  const rnd = noise(seed)
  const t: number[] = []
  const v: number[] = []
  for (let ms = 0; ms < durationMs; ms += 1000 / fps) {
    t.push(ms)
    v.push(Math.sin((2 * Math.PI * freqHz * ms) / 1000) + noiseAmp * rnd())
  }
  return { t, v }
}

describe('findPeaks', () => {
  it('finds all peaks of a clean sine', () => {
    const { t, v } = sine(2, 5000, 60) // 10 full cycles → 10 peaks
    const peaks = findPeaks(t, v, { minProminence: 0.5, minDistanceMs: 100 })
    expect(peaks.length).toBe(10)
    // Peaks near expected times (first at 125 ms, then every 500 ms)
    peaks.forEach((p, k) => {
      expect(Math.abs(p.t - (125 + k * 500))).toBeLessThan(20)
    })
  })

  it('survives moderate noise', () => {
    const { t, v } = sine(2, 5000, 60, 0.15, 42)
    const peaks = findPeaks(t, v, { minProminence: 0.8, minDistanceMs: 200 })
    expect(peaks.length).toBe(10)
  })

  it('filters out low-prominence ripples', () => {
    // Big 1 Hz wave with a tiny 8 Hz ripple on top
    const t: number[] = []
    const v: number[] = []
    for (let ms = 0; ms < 3000; ms += 10) {
      t.push(ms)
      v.push(Math.sin((2 * Math.PI * ms) / 1000) + 0.05 * Math.sin((2 * Math.PI * 8 * ms) / 1000))
    }
    const peaks = findPeaks(t, v, { minProminence: 0.5, minDistanceMs: 100 })
    expect(peaks.length).toBe(3)
  })

  it('enforces min distance, keeping the more prominent peak', () => {
    const t = [0, 10, 20, 30, 40]
    const v = [0, 5, 0, 4, 0] // peaks at i=1 (prom 5) and i=3 (prom 4), 20 ms apart
    const peaks = findPeaks(t, v, { minProminence: 0.5, minDistanceMs: 30 })
    expect(peaks.length).toBe(1)
    expect(peaks[0]!.i).toBe(1)
  })

  it('keeps a distant third peak after suppressing a near one', () => {
    const t = [0, 10, 20, 30, 40, 50, 60]
    const v = [0, 5, 0, 4, 0, 1, 0]
    const peaks = findPeaks(t, v, { minProminence: 0.5, minDistanceMs: 30 })
    expect(peaks.map((p) => p.i)).toEqual([1, 5])
  })

  it('handles plateaus at the center index', () => {
    const t = [0, 10, 20, 30, 40, 50]
    const v = [0, 1, 3, 3, 3, 0]
    const peaks = findPeaks(t, v, { minProminence: 1, minDistanceMs: 0 })
    expect(peaks.length).toBe(1)
    expect(peaks[0]!.i).toBe(3)
  })

  it('ignores plateaus that run into the array edge', () => {
    const peaks = findPeaks([0, 10, 20, 30], [0, 2, 2, 2], { minProminence: 0.5, minDistanceMs: 0 })
    expect(peaks.length).toBe(0)
  })

  it('returns nothing for empty or monotonic input', () => {
    expect(findPeaks([], [], { minProminence: 0, minDistanceMs: 0 })).toEqual([])
    const t = [0, 10, 20, 30]
    expect(findPeaks(t, [1, 2, 3, 4], { minProminence: 0, minDistanceMs: 0 })).toEqual([])
    expect(findPeaks(t, [4, 3, 2, 1], { minProminence: 0, minDistanceMs: 0 })).toEqual([])
  })

  it('respects minHeight', () => {
    const t = [0, 10, 20, 30, 40]
    const v = [0, 1, 0, 3, 0]
    const peaks = findPeaks(t, v, { minProminence: 0.5, minDistanceMs: 0, minHeight: 2 })
    expect(peaks.length).toBe(1)
    expect(peaks[0]!.v).toBe(3)
  })

  it('computes prominence relative to the higher surrounding base', () => {
    // Peak of 5 sitting on a shelf: left min 2, right min 0 → prominence 3
    const t = [0, 10, 20, 30, 40]
    const v = [6, 2, 5, 0, 7]
    const peaks = findPeaks(t, v, { minProminence: 0, minDistanceMs: 0 })
    expect(peaks.length).toBe(1)
    expect(peaks[0]!.prominence).toBe(3)
  })
})

describe('findValleys', () => {
  it('finds valleys with original values', () => {
    const { t, v } = sine(2, 3000, 60)
    const valleys = findValleys(t, v, { minProminence: 0.5, minDistanceMs: 100 })
    expect(valleys.length).toBe(6)
    for (const val of valleys) expect(val.v).toBeLessThan(-0.9)
  })
})
