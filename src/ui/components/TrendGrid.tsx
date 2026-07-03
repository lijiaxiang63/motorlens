// Longitudinal trend overview on the subject hub: one small-multiple cell
// per test × curated headline metric (the catalog's `spark` subset), each
// showing both hands overlaid — click through to the full trend screen.

import { catalogFor, formatMetric } from '../../analysis/metricCatalog'
import { buildTrend } from '../../analysis/trends'
import { TEST_DEFS } from '../../protocol/definitions'
import type { StoredResult } from '../../store/subjects'
import type { Hand } from '../../types'
import { useNav } from '../nav'
import { Sparkline } from './Sparkline'
import { Card, CardTitle } from './ui/card'

const HANDS: readonly Hand[] = ['left', 'right']

export function TrendGrid({
  results,
  subjectId,
}: {
  results: StoredResult[]
  subjectId: string
}) {
  const { navigate } = useNav()
  const testsWithData = TEST_DEFS.filter((def) => results.some((r) => r.testId === def.id))
  if (testsWithData.length === 0) return null

  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Trends</CardTitle>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <i className="inline-block size-2 rounded-full bg-chart-left" /> Left
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block size-2 rounded-full bg-chart-right" /> Right
          </span>
        </div>
      </div>
      {testsWithData.map((def) => (
        <div key={def.id} className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">{def.title}</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {catalogFor(def.id)
              .filter((d) => d.spark)
              .map((metricDef) => {
              const byHand = HANDS.map((hand) => ({
                hand,
                trend: buildTrend(results, def.id, hand, metricDef.key),
              }))
              if (!byHand.some((b) => b.trend.points.length > 0)) return null
              const latest = byHand
                .flatMap((b) => b.trend.points)
                .filter((p) => p.value !== null)
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
              return (
                <button
                  key={metricDef.key}
                  type="button"
                  data-testid="trend-cell"
                  onClick={() =>
                    navigate({ name: 'trend', subjectId, testId: def.id, metricKey: metricDef.key })
                  }
                  className="rounded-lg border bg-surface-2 px-2.5 py-2 text-left hover:border-border-strong"
                >
                  <div className="text-[11px] text-muted-foreground">{metricDef.label}</div>
                  <Sparkline series={byHand.map((b) => ({ hand: b.hand, points: b.trend.points }))} />
                  <div className="text-xs tabular-nums">
                    {latest ? formatMetric(metricDef, latest.value) : '—'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </Card>
  )
}
