// Longitudinal trend for one metric of one test+hand: a null-safe point
// series, "vs previous" delta, and a Theil–Sen slope (median of pairwise
// slopes — outlier-robust, unlike an OLS fit a single bad session can't
// swing) per 30 days.

import { median } from '../signal/stats'
import type { StoredResult } from '../store/subjects'
import type { CycleTestMetrics, Hand, TestId } from '../types'
import { METRIC_CATALOG, cycleMetricsOf, metricByKey, type MetricKey } from './metricCatalog'

const MS_PER_DAY = 86_400_000

export interface TrendPoint {
  resultId: string
  startedAt: string
  /** Days elapsed since the earliest point in this trend. */
  tDays: number
  /** null = a gap (metric unavailable that session), never coerced to 0. */
  value: number | null
}

export interface TrendLine {
  slopePerDay: number
  intercept: number
}

export interface Trend {
  /** Ascending by startedAt, independent of input order. */
  points: TrendPoint[]
  /** Last point's value minus the last non-null value strictly before it.
   *  Null if the last value is null or no non-null prior point exists. */
  deltaVsPrevious: number | null
  /** Theil–Sen slope (median of pairwise slopes across all valid point
   *  pairs), ×30 → units per 30 days. Null with fewer than 2 non-null points. */
  slopePer30d: number | null
  /** Robust fit line for drawing the trend chart; null iff slopePer30d is. */
  line: TrendLine | null
}

export function buildTrend(
  results: StoredResult[],
  testId: TestId,
  hand: Hand,
  key: MetricKey,
): Trend {
  const def = metricByKey(key)
  const matches = results
    .filter((r) => r.testId === testId && r.hand === hand && cycleMetricsOf(r.report) !== null)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  if (matches.length === 0) {
    return { points: [], deltaVsPrevious: null, slopePer30d: null, line: null }
  }

  const t0 = Date.parse(matches[0]!.startedAt)
  const points: TrendPoint[] = matches.map((r) => ({
    resultId: r.id,
    startedAt: r.startedAt,
    tDays: (Date.parse(r.startedAt) - t0) / MS_PER_DAY,
    value: def.getter(cycleMetricsOf(r.report)!),
  }))

  let deltaVsPrevious: number | null = null
  const last = points[points.length - 1]!
  if (last.value !== null) {
    for (let i = points.length - 2; i >= 0; i--) {
      const prior = points[i]!.value
      if (prior !== null) {
        deltaVsPrevious = last.value - prior
        break
      }
    }
  }

  const slopes: number[] = []
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!
      const b = points[j]!
      if (a.value === null || b.value === null) continue
      const dt = b.tDays - a.tDays
      if (dt <= 0) continue
      slopes.push((b.value - a.value) / dt)
    }
  }

  let slopePer30d: number | null = null
  let line: TrendLine | null = null
  if (slopes.length > 0) {
    const slopePerDay = median(slopes)
    slopePer30d = slopePerDay * 30
    const intercepts = points
      .filter((p) => p.value !== null)
      .map((p) => p.value! - slopePerDay * p.tDays)
    line = { slopePerDay, intercept: median(intercepts) }
  }

  return { points, deltaVsPrevious, slopePer30d, line }
}

/** Results-screen delta chips: for each catalog metric, the current value
 *  minus the last non-null value among `priors` (sorted newest-first
 *  internally) — null when the current value or every prior is null. */
export function deltasVsPrevious(
  current: CycleTestMetrics,
  priors: StoredResult[],
): Partial<Record<MetricKey, number | null>> {
  const sorted = priors
    .filter((r) => cycleMetricsOf(r.report) !== null)
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))

  const out: Partial<Record<MetricKey, number | null>> = {}
  for (const def of METRIC_CATALOG) {
    const currentValue = def.getter(current)
    if (currentValue === null) {
      out[def.key] = null
      continue
    }
    let priorValue: number | null = null
    for (const r of sorted) {
      const v = def.getter(cycleMetricsOf(r.report)!)
      if (v !== null) {
        priorValue = v
        break
      }
    }
    out[def.key] = priorValue === null ? null : currentValue - priorValue
  }
  return out
}
