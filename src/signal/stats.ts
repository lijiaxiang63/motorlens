export function mean(v: number[]): number {
  if (v.length === 0) return NaN
  let s = 0
  for (const x of v) s += x
  return s / v.length
}

/** Sample standard deviation (n−1). */
export function sd(v: number[]): number {
  if (v.length < 2) return NaN
  const m = mean(v)
  let s = 0
  for (const x of v) s += (x - m) * (x - m)
  return Math.sqrt(s / (v.length - 1))
}

/** Coefficient of variation, %. NaN when mean ≈ 0 or fewer than 2 values. */
export function cvPct(v: number[]): number {
  const m = mean(v)
  if (!Number.isFinite(m) || Math.abs(m) < 1e-12) return NaN
  return (sd(v) / m) * 100
}

export function median(v: number[]): number {
  return percentile(v, 50)
}

/** Percentile with linear interpolation, p in [0, 100]. */
export function percentile(v: number[], p: number): number {
  if (v.length === 0) return NaN
  const sorted = [...v].sort((a, b) => a - b)
  const pos = (Math.min(Math.max(p, 0), 100) / 100) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]!
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export interface Regression {
  slope: number
  intercept: number
}

/** Ordinary least squares of y over x. */
export function linearRegression(x: number[], y: number[]): Regression {
  const n = Math.min(x.length, y.length)
  if (n < 2) return { slope: NaN, intercept: NaN }
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += x[i]!
    sy += y[i]!
    sxx += x[i]! * x[i]!
    sxy += x[i]! * y[i]!
  }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-12) return { slope: NaN, intercept: NaN }
  const slope = (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n }
}
