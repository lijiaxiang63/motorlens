// Result-to-result comparison: a catalog-driven delta table always, plus a
// t=0-rebased signal overlay and a per-event amplitude overlay when both
// results are the same test (comparing a tap signal against a fist signal
// has no shared meaning, so those charts are disabled rather than faked).

import { familyOfTest } from '../protocol/definitions'
import type { StoredResult } from '../store/subjects'
import type { Series } from '../types'
import {
  catalogFor,
  metricValue,
  type AnyMetricDef,
  type MetricDirection,
  type MetricKey,
} from './metricCatalog'

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
 *  newer by startedAt) since "which one is baseline" is a caller decision.
 *  Rows span the union of both tests' catalogs (deduped by key, A's units
 *  win) — a cross-family compare degrades to one-sided-null rows, never
 *  crashes. The per-event amplitude overlay is cycle-only: other families
 *  store no events, and an empty overlay would be noise, not data. */
export function buildCompare(a: StoredResult, b: StoredResult): CompareData {
  const sameTest = a.testId === b.testId

  const catalog: AnyMetricDef[] = [...catalogFor(a.testId)]
  for (const def of catalogFor(b.testId)) {
    if (!catalog.some((d) => d.key === def.key)) catalog.push(def)
  }

  const rows: CompareRow[] = catalog.map((def) => {
    const av = metricValue(def, a.report)
    const bv = metricValue(def, b.report)
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
    amplitudes:
      sameTest && familyOfTest(a.testId) === 'cycle'
        ? {
            a: a.report.events.map((e) => e.closingAmplitude),
            b: b.report.events.map((e) => e.closingAmplitude),
          }
        : null,
  }
}
