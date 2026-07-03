// Bilateral L/R asymmetry over the per-test metric catalog. Ratio-scale
// metrics (frequency, amplitude, velocities — all non-negative, true-zero
// scale) use a signed asymmetry index; percentage/count metrics that can sit
// near zero on both sides use a raw point difference instead (AI% is
// unstable near a zero denominator).

import type { SessionReport, TestId } from '../types'
import {
  catalogFor,
  metricValue,
  metricValueOf,
  roundsToZero,
  type AnyMetricDef,
  type MetricDirection,
  type MetricKey,
} from './metricCatalog'
import type { HandPair } from './pairing'

export interface AsymmetryRow {
  key: MetricKey
  label: string
  /** Display precision/unit from the test's own catalog (degree tests get
   *  degree units) — consumers format rows without a global key lookup. */
  digits: number
  unit: string
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

function asymmetryValue(
  def: AnyMetricDef,
  left: number | null,
  right: number | null,
): number | null {
  if (left === null || right === null) return null
  if (def.asymmetry === 'points') return right - left
  const denom = right + left
  if (Math.abs(denom) < 1e-9) return 0
  return (200 * (right - left)) / denom
}

function asymmetryRow(def: AnyMetricDef, l: number | null, r: number | null): AsymmetryRow {
  return {
    key: def.key,
    label: def.label,
    digits: def.digits,
    unit: def.unit,
    left: l,
    right: r,
    kind: def.asymmetry,
    direction: def.direction,
    value: asymmetryValue(def, l, r),
  }
}

/** Pure over metrics objects, not StoredResults — callers unwrap reports and
 *  guarantee both sides match `testId`'s family (asymmetryForPair does this
 *  via the family-checked metricValue instead). */
export function computeAsymmetry(
  testId: TestId,
  left: SessionReport['metrics'] | null,
  right: SessionReport['metrics'] | null,
): AsymmetryRow[] {
  return catalogFor(testId).map((def) =>
    asymmetryRow(
      def,
      left ? metricValueOf(def, left) : null,
      right ? metricValueOf(def, right) : null,
    ),
  )
}

export function asymmetryForPair(pair: HandPair): AsymmetryRow[] {
  return catalogFor(pair.testId).map((def) =>
    asymmetryRow(
      def,
      pair.left ? metricValue(def, pair.left.report) : null,
      pair.right ? metricValue(def, pair.right.report) : null,
    ),
  )
}

/** '+22%' / '−3 pts' / '—'. Explicit sign (positive = right larger), never
 *  relying on fmt()'s implicit negative-only sign. Points-kind values use the
 *  metric's own display precision (e.g. whole hesitations, whole percentage
 *  points), rather than a fixed decimal count that wouldn't fit every metric. */
export function formatAsymmetryValue(row: AsymmetryRow): string {
  if (row.value === null || !Number.isFinite(row.value)) return '—'
  const digits = row.kind === 'ratio' ? 0 : row.digits
  const zero = roundsToZero(row.value, digits)
  const sign = zero ? '±' : row.value > 0 ? '+' : '−'
  const abs = Math.abs(row.value)
  return row.kind === 'ratio' ? `${sign}${abs.toFixed(0)}%` : `${sign}${abs.toFixed(digits)} pts`
}
