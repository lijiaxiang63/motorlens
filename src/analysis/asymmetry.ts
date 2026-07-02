// Bilateral L/R asymmetry over the metric catalog. Ratio-scale metrics
// (frequency, amplitude, velocities — all non-negative, true-zero scale)
// use a signed asymmetry index; percentage/count metrics that can sit near
// zero on both sides use a raw point difference instead (AI% is unstable
// near a zero denominator).

import type { CycleTestMetrics } from '../types'
import {
  METRIC_CATALOG,
  cycleMetricsOf,
  roundsToZero,
  type MetricDef,
  type MetricDirection,
  type MetricKey,
} from './metricCatalog'
import type { HandPair } from './pairing'

export interface AsymmetryRow {
  key: MetricKey
  label: string
  left: number | null
  right: number | null
  kind: 'ratio' | 'points'
  direction: MetricDirection
  /** ratio: AI% = 200·(right−left)/(right+left), positive = right larger.
   *  points: right−left. Null whenever either side is null. Never NaN or
   *  Infinity — a nearly-zero ratio denominator (both sides ≈ 0) reports 0
   *  (no asymmetry) rather than dividing by ~0. */
  value: number | null
}

function asymmetryValue(def: MetricDef, left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null
  if (def.asymmetry === 'points') return right - left
  const denom = right + left
  if (Math.abs(denom) < 1e-9) return 0
  return (200 * (right - left)) / denom
}

/** Pure over metrics objects, not StoredResults — callers unwrap reports. */
export function computeAsymmetry(
  left: CycleTestMetrics | null,
  right: CycleTestMetrics | null,
): AsymmetryRow[] {
  return METRIC_CATALOG.map((def) => {
    const l = left ? def.getter(left) : null
    const r = right ? def.getter(right) : null
    return {
      key: def.key,
      label: def.label,
      left: l,
      right: r,
      kind: def.asymmetry,
      direction: def.direction,
      value: asymmetryValue(def, l, r),
    }
  })
}

export function asymmetryForPair(pair: HandPair): AsymmetryRow[] {
  const left = pair.left ? cycleMetricsOf(pair.left.report) : null
  const right = pair.right ? cycleMetricsOf(pair.right.report) : null
  return computeAsymmetry(left, right)
}

/** '+22%' / '−3 pts' / '—'. Explicit sign (positive = right larger), never
 *  relying on fmt()'s implicit negative-only sign. Points-kind values use the
 *  metric's own display precision (e.g. whole hesitations, whole percentage
 *  points), rather than a fixed decimal count that wouldn't fit every metric. */
export function formatAsymmetryValue(def: MetricDef, row: AsymmetryRow): string {
  if (row.value === null || !Number.isFinite(row.value)) return '—'
  const digits = row.kind === 'ratio' ? 0 : def.digits
  const zero = roundsToZero(row.value, digits)
  const sign = zero ? '±' : row.value > 0 ? '+' : '−'
  const abs = Math.abs(row.value)
  return row.kind === 'ratio' ? `${sign}${abs.toFixed(0)}%` : `${sign}${abs.toFixed(digits)} pts`
}
