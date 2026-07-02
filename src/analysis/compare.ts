// Result-to-result comparison: a catalog-driven delta table always, plus a
// t=0-rebased signal overlay and a per-event amplitude overlay when both
// results are the same test (comparing a tap signal against a fist signal
// has no shared meaning, so those charts are disabled rather than faked).

import type { StoredResult } from '../store/subjects'
import type { Series } from '../types'
import { METRIC_CATALOG, cycleMetricsOf, type MetricDirection, type MetricKey } from './metricCatalog'

export interface CompareRow {
  key: MetricKey
  label: string
  digits: number
  unit: string
  direction: MetricDirection
  a: number | null
  b: number | null
  /** b − a. Null when either side is null. */
  delta: number | null
}

export interface CompareData {
  sameTest: boolean
  rows: CompareRow[]
  /** Both series rebased so t[0] === 0 — the stored series carry page-time
   *  timestamps, not a shared origin. Null when the tests differ. */
  signals: { a: Series; b: Series } | null
  /** Per-event closing amplitude, in event order. Null when the tests differ. */
  amplitudes: { a: number[]; b: number[] } | null
}

function rebase(series: Series): Series {
  if (series.t.length === 0) return series
  const t0 = series.t[0]!
  return { t: series.t.map((t) => t - t0), v: series.v }
}

/** `a`/`b` are compared as-is (b − a) — callers order them (e.g. older vs
 *  newer by startedAt) since "which one is baseline" is a caller decision. */
export function buildCompare(a: StoredResult, b: StoredResult): CompareData {
  const sameTest = a.testId === b.testId
  const ma = cycleMetricsOf(a.report)
  const mb = cycleMetricsOf(b.report)

  const rows: CompareRow[] = METRIC_CATALOG.map((def) => {
    const av = ma ? def.getter(ma) : null
    const bv = mb ? def.getter(mb) : null
    return {
      key: def.key,
      label: def.label,
      digits: def.digits,
      unit: def.unit,
      direction: def.direction,
      a: av,
      b: bv,
      delta: av !== null && bv !== null ? bv - av : null,
    }
  })

  return {
    sameTest,
    rows,
    signals: sameTest ? { a: rebase(a.report.series), b: rebase(b.report.series) } : null,
    amplitudes: sameTest
      ? {
          a: a.report.events.map((e) => e.closingAmplitude),
          b: b.report.events.map((e) => e.closingAmplitude),
        }
      : null,
  }
}
