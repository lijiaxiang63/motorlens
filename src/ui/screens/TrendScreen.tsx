// Longitudinal trend detail: metric picker, hand toggle, a time-scaled
// chart with the Theil–Sen line, and a session table that click-throughs
// into the same recompute-from-raw-frames results view as the subject hub.

import { useEffect, useState } from 'react'
import {
  catalogFor,
  formatDelta,
  formatMetric,
  metricByKeyFor,
  type MetricKey,
} from '../../analysis/metricCatalog'
import { buildTrend } from '../../analysis/trends'
import { testDefById } from '../../protocol/definitions'
import { getSubject, listResults, type StoredResult, type Subject } from '../../store/subjects'
import type { Hand, TestId } from '../../types'
import { TrendChart } from '../charts/charts'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { useNav } from '../nav'
import { viewStoredResult } from '../viewResult'

const HANDS: readonly Hand[] = ['left', 'right']

export function TrendScreen({
  subjectId,
  testId,
  metricKey: initialMetricKey,
  hand: initialHand,
}: {
  subjectId: string
  testId: TestId
  metricKey: MetricKey
  hand?: Hand
}) {
  const { navigate } = useNav()
  const [subject, setSubject] = useState<Subject | null | 'missing'>(null)
  const [results, setResults] = useState<StoredResult[]>([])
  const [metricKey, setMetricKey] = useState(initialMetricKey)
  const [hand, setHand] = useState<Hand>(initialHand ?? 'right')

  useEffect(() => {
    let alive = true
    void Promise.all([getSubject(subjectId), listResults(subjectId)]).then(([s, rs]) => {
      if (!alive) return
      setSubject(s ?? 'missing')
      setResults(rs)
    })
    return () => {
      alive = false
    }
  }, [subjectId])

  if (subject === null) return <p className="p-6 text-muted-foreground">Loading…</p>
  if (subject === 'missing') return <p className="p-6 text-muted-foreground">Subject not found.</p>

  const def = testDefById(testId)
  if (!def) return <p className="p-6 text-muted-foreground">Unknown test.</p>

  const metricDef = metricByKeyFor(testId, metricKey)
  const trend = buildTrend(results, testId, hand, metricKey)

  // Per-row "vs previous" delta: current value minus the last non-null value
  // strictly before it in the same ascending series.
  const rowDeltas: (number | null)[] = trend.points.map((p, i) => {
    if (p.value === null) return null
    for (let j = i - 1; j >= 0; j--) {
      const prior = trend.points[j]!.value
      if (prior !== null) return p.value - prior
    }
    return null
  })

  return (
    <div className="mx-auto max-w-[900px] px-6 pb-12 pt-6">
      <PageHeader
        title={`${def.title} — ${metricDef.label} trend`}
        description={`${hand === 'left' ? 'Left' : 'Right'} hand · ${subject.code}`}
        actions={
          <Button variant="ghost" onClick={() => navigate({ name: 'subject', subjectId })}>
            ← {subject.code}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {HANDS.map((h) => (
            <Button
              key={h}
              size="sm"
              variant={h === hand ? 'primary' : 'ghost'}
              onClick={() => setHand(h)}
            >
              {h === 'left' ? 'Left' : 'Right'}
            </Button>
          ))}
        </div>
        <select
          className="rounded-md border bg-surface px-2 py-1 text-sm"
          value={metricKey}
          onChange={(e) => setMetricKey(e.target.value as MetricKey)}
        >
          {catalogFor(testId).map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        {trend.slopePer30d !== null && (
          <span className="text-sm text-muted-foreground">
            Trend: {formatDelta(metricDef, trend.slopePer30d)} / 30 days
          </span>
        )}
      </div>

      {trend.points.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {hand}-hand results for this test yet.</p>
      ) : (
        <>
          <TrendChart points={trend.points} line={trend.line} yLabel={metricDef.label} />
          <div className="mt-4 flex flex-col divide-y divide-border rounded-xl border bg-surface">
            {trend.points
              .map((p, i) => ({ point: p, delta: rowDeltas[i]! }))
              .reverse()
              .map(({ point, delta }) => {
                const r = results.find((x) => x.id === point.resultId)
                return (
                  <button
                    key={point.resultId}
                    type="button"
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => r && viewStoredResult(navigate, subject, r)}
                  >
                    <span className="text-muted-foreground">
                      {new Date(point.startedAt).toLocaleString()}
                    </span>
                    <span className="tabular-nums">{formatMetric(metricDef, point.value)}</span>
                    <span className="w-20 text-right tabular-nums text-xs text-muted-foreground">
                      {delta !== null ? formatDelta(metricDef, delta) : ''}
                    </span>
                  </button>
                )
              })}
          </div>
        </>
      )}
    </div>
  )
}
