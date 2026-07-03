// Pure spectral analysis for the tremor tests: uniform resampling, linear
// detrend, in-module radix-2 FFT, and a Welch power spectral density with a
// Hann window. Zero dependencies, DOM-free, node-testable like the rest of
// src/signal/.

import type { Series } from '../types'

/** One-sided power spectral density: power[i] at freqHz[i], unit²/Hz. */
export interface Psd {
  freqHz: number[]
  power: number[]
}

/** In-place radix-2 Cooley–Tukey FFT. Lengths must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n !== im.length || (n & (n - 1)) !== 0) {
    throw new Error(`fft length must be a power of two, got ${n}`)
  }
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  // Danielson–Lanczos butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = i + k + len / 2
        const tRe = re[b]! * curRe - im[b]! * curIm
        const tIm = re[b]! * curIm + im[b]! * curRe
        re[b] = re[a]! - tRe
        im[b] = im[a]! - tIm
        re[a] = re[a]! + tRe
        im[a] = im[a]! + tIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** Linear interpolation of a (possibly jittered) series onto a uniform grid
 *  at fsHz, spanning the series' own time range. Empty/singleton input
 *  passes through as values. */
export function resampleUniform(s: Series, fsHz: number): number[] {
  const n = s.t.length
  if (n === 0) return []
  if (n === 1) return [s.v[0]!]
  const dt = 1000 / fsHz
  const t0 = s.t[0]!
  const tEnd = s.t[n - 1]!
  const out: number[] = []
  let j = 0
  for (let t = t0; t <= tEnd + 1e-9; t += dt) {
    while (j < n - 2 && s.t[j + 1]! < t) j++
    const ta = s.t[j]!
    const tb = s.t[j + 1]!
    const u = tb > ta ? Math.min(Math.max((t - ta) / (tb - ta), 0), 1) : 0
    out.push(s.v[j]! + (s.v[j + 1]! - s.v[j]!) * u)
  }
  return out
}

/** Removes the least-squares line (OLS over sample index) from `v`. */
export function detrendLinear(v: number[]): number[] {
  const n = v.length
  if (n < 2) return v.map(() => 0)
  // x = 0..n-1: closed-form OLS.
  const xMean = (n - 1) / 2
  let yMean = 0
  for (const y of v) yMean += y
  yMean /= n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (i - xMean) * (v[i]! - yMean)
    sxx += (i - xMean) * (i - xMean)
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const intercept = yMean - slope * xMean
  return v.map((y, i) => y - (slope * i + intercept))
}

/** Welch PSD: Hann-windowed segments (50% overlap by default), window-power
 *  normalized so that Σ power·df equals the signal variance (Parseval).
 *  Input shorter than segLen falls back to a single segment truncated to the
 *  largest power of two. Returns empty arrays when fewer than 8 samples. */
export function welchPsd(
  v: number[],
  fsHz: number,
  opts: { segLen?: number; overlap?: number } = {},
): Psd {
  const requested = opts.segLen ?? 128
  const overlap = opts.overlap ?? 0.5
  let segLen = requested
  if (v.length < segLen) {
    segLen = 1
    while (segLen * 2 <= v.length) segLen *= 2
  }
  if (segLen < 8) return { freqHz: [], power: [] }

  const hann = new Float64Array(segLen)
  let windowPower = 0
  for (let i = 0; i < segLen; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segLen - 1)))
    windowPower += hann[i]! * hann[i]!
  }

  const hop = Math.max(1, Math.round(segLen * (1 - overlap)))
  const half = segLen / 2
  const acc = new Float64Array(half + 1)
  let segments = 0
  const re = new Float64Array(segLen)
  const im = new Float64Array(segLen)
  for (let start = 0; start + segLen <= v.length; start += hop) {
    // Per-segment mean removal keeps leftover DC out of the low bins.
    let mean = 0
    for (let i = 0; i < segLen; i++) mean += v[start + i]!
    mean /= segLen
    for (let i = 0; i < segLen; i++) {
      re[i] = (v[start + i]! - mean) * hann[i]!
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k <= half; k++) {
      const mag2 = re[k]! * re[k]! + im[k]! * im[k]!
      // One-sided: double the interior bins (DC and Nyquist appear once).
      const scale = k === 0 || k === half ? 1 : 2
      acc[k] = acc[k]! + (scale * mag2) / (fsHz * windowPower)
    }
    segments++
  }
  if (segments === 0) return { freqHz: [], power: [] }

  const freqHz: number[] = []
  const power: number[] = []
  for (let k = 0; k <= half; k++) {
    freqHz.push((k * fsHz) / segLen)
    power.push(acc[k]! / segments)
  }
  return { freqHz, power }
}

/** Integrated band power over [f0, f1] via the trapezoid-free bin sum
 *  (power·df per bin — consistent with the Parseval normalization). */
export function bandPower(psd: Psd, f0: number, f1: number): number {
  if (psd.freqHz.length < 2) return 0
  const df = psd.freqHz[1]! - psd.freqHz[0]!
  let sum = 0
  for (let i = 0; i < psd.freqHz.length; i++) {
    const f = psd.freqHz[i]!
    if (f >= f0 && f <= f1) sum += psd.power[i]! * df
  }
  return sum
}

/** Highest-power bin within [f0, f1], or null when the band holds no bins
 *  or carries no power. */
export function dominantFrequency(
  psd: Psd,
  f0: number,
  f1: number,
): { freqHz: number; power: number } | null {
  let best: { freqHz: number; power: number } | null = null
  for (let i = 0; i < psd.freqHz.length; i++) {
    const f = psd.freqHz[i]!
    if (f < f0 || f > f1) continue
    if (best === null || psd.power[i]! > best.power) {
      best = { freqHz: f, power: psd.power[i]! }
    }
  }
  return best !== null && best.power > 0 ? best : null
}
