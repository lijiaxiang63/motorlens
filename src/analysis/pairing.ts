// Groups stored results into left/right same-day pairs for bilateral
// asymmetry — the clinical convention of comparing the two hands' most
// recent session on a given day, not every recording ever made.

import type { StoredResult } from '../store/subjects'
import type { TestId } from '../types'
import { cycleMetricsOf } from './metricCatalog'

export interface HandPair {
  dayKey: string
  testId: TestId
  /** Latest same-day result for that hand, or null if that hand wasn't run. */
  left: StoredResult | null
  right: StoredResult | null
}

/** Local-clock `YYYY-MM-DD`. Deliberately local, not UTC: a clinical "same
 *  day" pair means the operator's day, and `startedAt` is written from the
 *  local clock's `toISOString()` — grouping in UTC could split an evening
 *  session across two "days" depending on the operator's timezone. */
export function localDayKey(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** One pair per local day that has ≥1 cycle-metrics result for `testId`,
 *  newest day first. Each side is the latest (max `startedAt`) result for
 *  that hand that day — a newer same-day result on one side replaces an
 *  older one. Results without cycle metrics (e.g. joint_monitor) are
 *  excluded, never crash the grouping. */
export function pairResults(results: StoredResult[], testId: TestId): HandPair[] {
  const byDay = new Map<string, { left: StoredResult | null; right: StoredResult | null }>()
  for (const r of results) {
    if (r.testId !== testId || cycleMetricsOf(r.report) === null) continue
    const dayKey = localDayKey(r.startedAt)
    const entry = byDay.get(dayKey) ?? { left: null, right: null }
    const slot = r.hand === 'left' ? 'left' : 'right'
    const current = entry[slot]
    // startedAt strings are all UTC 'Z'-format ISO, so lexicographic
    // comparison is chronological.
    if (!current || r.startedAt > current.startedAt) entry[slot] = r
    byDay.set(dayKey, entry)
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayKey, { left, right }]) => ({ dayKey, testId, left, right }))
}
