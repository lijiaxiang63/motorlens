import { describe, expect, it } from 'vitest'
import { bandPower, detrendLinear, dominantFrequency, fft, resampleUniform, welchPsd } from './spectrum'

/** Uniform 30 Hz sinusoid samples: amp·sin(2π·f·t) (+ optional second tone). */
function sine(freqHz: number, n: number, fsHz = 30, amp = 1): number[] {
  return Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * freqHz * i) / fsHz))
}

function variance(v: number[]): number {
  const mean = v.reduce((s, x) => s + x, 0) / v.length
  return v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length
}

describe('fft', () => {
  it('puts a single-bin sine entirely in its bin (round-trip sanity)', () => {
    const n = 64
    const k = 5 // exactly periodic in the window
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * k * i) / n)
    fft(re, im)
    const mags = Array.from({ length: n }, (_, i) => Math.hypot(re[i]!, im[i]!))
    // Energy concentrated at bins k and n−k; everything else ≈ 0.
    expect(mags[k]!).toBeCloseTo(n / 2, 6)
    expect(mags[n - k]!).toBeCloseTo(n / 2, 6)
    for (let i = 0; i < n; i++) {
      if (i === k || i === n - k) continue
      expect(mags[i]!).toBeLessThan(1e-9)
    }
  })

  it('rejects non-power-of-two lengths', () => {
    expect(() => fft(new Float64Array(12), new Float64Array(12))).toThrow()
  })
})

describe('resampleUniform', () => {
  it('reproduces a linear ramp exactly despite jittered timestamps', () => {
    // v(t) = 0.25·t over jittered samples — linear interpolation is exact.
    const t: number[] = []
    const v: number[] = []
    let time = 0
    for (let i = 0; i < 100; i++) {
      t.push(time)
      v.push(0.25 * time)
      time += 30 + ((i * 7919) % 11) - 5 // deterministic ±5 ms jitter
    }
    const out = resampleUniform({ t, v }, 30)
    const dt = 1000 / 30
    for (let i = 0; i < out.length; i++) {
      // 10 dp — the uniform grid accumulates t0 + i·dt in floating point.
      expect(out[i]!).toBeCloseTo(0.25 * (t[0]! + i * dt), 10)
    }
  })

  it('handles empty and singleton input', () => {
    expect(resampleUniform({ t: [], v: [] }, 30)).toEqual([])
    expect(resampleUniform({ t: [100], v: [7] }, 30)).toEqual([7])
  })
})

describe('detrendLinear', () => {
  it('removes an exact linear trend', () => {
    const v = Array.from({ length: 50 }, (_, i) => 3 + 0.2 * i)
    for (const y of detrendLinear(v)) expect(Math.abs(y)).toBeLessThan(1e-9)
  })
})

describe('welchPsd', () => {
  it('finds a 5 Hz dominant within half a bin on 15 s of 30 Hz samples', () => {
    const v = sine(5, 450)
    const psd = welchPsd(v, 30)
    const dom = dominantFrequency(psd, 3, 12)
    expect(dom).not.toBeNull()
    // Bin width 30/128 ≈ 0.234 Hz → max error ≈ 0.117 Hz.
    expect(Math.abs(dom!.freqHz - 5)).toBeLessThan(0.15)
  })

  it('satisfies Parseval: total PSD power equals the signal variance within 1%', () => {
    const v = sine(5, 450)
    const psd = welchPsd(v, 30)
    const total = bandPower(psd, 0, 15)
    expect(Math.abs(total - variance(v)) / variance(v)).toBeLessThan(0.01)
  })

  it('resolves both tones of a 4+8 Hz mixture, dominant at 4 Hz', () => {
    const four = sine(4, 450)
    const eight = sine(8, 450, 30, 0.6)
    const v = four.map((x, i) => x + eight[i]!)
    const psd = welchPsd(v, 30)
    const dom = dominantFrequency(psd, 3, 12)
    expect(Math.abs(dom!.freqHz - 4)).toBeLessThan(0.15)
    // The 8 Hz tone stands far above the noise floor.
    const at8 = dominantFrequency(psd, 7.7, 8.3)!
    const sorted = [...psd.power].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]!
    expect(at8.power).toBeGreaterThan(10 * median)
  })

  it('falls back to a truncated single segment for short input', () => {
    const v = sine(5, 100) // < 128 samples → one 64-sample segment
    const psd = welchPsd(v, 30)
    expect(psd.freqHz.length).toBe(33) // 64/2 + 1
    const dom = dominantFrequency(psd, 3, 12)
    expect(Math.abs(dom!.freqHz - 5)).toBeLessThan(0.3) // wider bins (0.47 Hz)
  })

  it('returns empty for fewer than 8 samples and null dominant on silence', () => {
    expect(welchPsd([1, 2, 3], 30).freqHz).toEqual([])
    const flat = welchPsd(new Array(450).fill(2), 30)
    expect(dominantFrequency(flat, 3, 12)).toBeNull()
  })
})
