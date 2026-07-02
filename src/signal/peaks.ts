// scipy-equivalent peak detection: local maxima (plateau-aware), prominence
// filtering, then greedy time-distance suppression by prominence rank.

export interface PeakOptions {
  minProminence: number
  minDistanceMs: number
  minHeight?: number
}

export interface Peak {
  /** Sample index. */
  i: number
  /** Time, ms. */
  t: number
  /** Signal value at the peak (original sign for valleys too). */
  v: number
  prominence: number
}

/** Local maxima with plateau handling: an equal-run flanked by strictly
 *  smaller samples on both sides counts once, at its center index. */
function localMaxima(v: number[]): number[] {
  const n = v.length
  const out: number[] = []
  let i = 1
  while (i < n - 1) {
    if (v[i]! > v[i - 1]!) {
      let j = i
      while (j < n - 1 && v[j + 1]! === v[i]!) j++
      if (j < n - 1 && v[j + 1]! < v[i]!) {
        out.push(Math.floor((i + j) / 2))
      }
      i = j + 1
    } else {
      i++
    }
  }
  return out
}

/** Prominence: peak height above the higher of the two lowest points reached
 *  before meeting a taller sample (or the signal edge) on each side. */
function prominenceAt(v: number[], p: number): number {
  const vp = v[p]!
  let leftMin = vp
  for (let k = p - 1; k >= 0; k--) {
    if (v[k]! > vp) break
    if (v[k]! < leftMin) leftMin = v[k]!
  }
  let rightMin = vp
  for (let k = p + 1; k < v.length; k++) {
    if (v[k]! > vp) break
    if (v[k]! < rightMin) rightMin = v[k]!
  }
  return vp - Math.max(leftMin, rightMin)
}

export function findPeaks(t: number[], v: number[], opts: PeakOptions): Peak[] {
  const candidates: Peak[] = []
  for (const i of localMaxima(v)) {
    if (opts.minHeight !== undefined && v[i]! < opts.minHeight) continue
    const prom = prominenceAt(v, i)
    if (prom < opts.minProminence) continue
    candidates.push({ i, t: t[i]!, v: v[i]!, prominence: prom })
  }
  // Greedy suppression: keep the most prominent, drop anything too close.
  const byProminence = [...candidates].sort(
    (a, b) => b.prominence - a.prominence || a.i - b.i,
  )
  const kept: Peak[] = []
  for (const c of byProminence) {
    if (kept.every((k) => Math.abs(k.t - c.t) >= opts.minDistanceMs)) kept.push(c)
  }
  return kept.sort((a, b) => a.i - b.i)
}

/** Peaks of the negated signal; `v` is reported in original units. */
export function findValleys(t: number[], v: number[], opts: PeakOptions): Peak[] {
  const neg = v.map((x) => -x)
  return findPeaks(t, neg, { ...opts, minHeight: undefined }).map((p) => ({
    ...p,
    v: v[p.i]!,
  }))
}
