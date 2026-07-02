// Bilateral L/R asymmetry: one card per test that has ≥1 same-day pair,
// mirrored horizontal bar pairs (left = orange, right = blue — the fixed
// bilateral convention shared with trends/comparison) and an AI%/points
// badge per headline metric, with a day selector when there's more than one
// paired day.

import { useState } from 'react'
import { ASYMMETRY_WARN_POINTS, ASYMMETRY_WARN_RATIO_PCT } from '../../config'
import { formatAsymmetryValue, type AsymmetryRow, asymmetryForPair } from '../../analysis/asymmetry'
import { formatMetric, metricByKey } from '../../analysis/metricCatalog'
import type { HandPair } from '../../analysis/pairing'
import { pairResults } from '../../analysis/pairing'
import { TEST_DEFS, type TestDefinition } from '../../protocol/definitions'
import type { StoredResult, Subject } from '../../store/subjects'
import { cn } from '../lib/cn'
import { Card, CardTitle } from './ui/card'
import { StatusChip } from './StatusChip'

function dayLabel(dayKey: string): string {
  // dayKey is local Y-M-D; parsing without a time zone offset keeps it local.
  const d = new Date(`${dayKey}T00:00:00`)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isNotable(row: AsymmetryRow): boolean {
  if (row.value === null) return false
  const threshold = row.kind === 'ratio' ? ASYMMETRY_WARN_RATIO_PCT : ASYMMETRY_WARN_POINTS
  return Math.abs(row.value) > threshold
}

function BarRow({ row }: { row: AsymmetryRow }) {
  const def = metricByKey(row.key)
  const denom = Math.max(Math.abs(row.left ?? 0), Math.abs(row.right ?? 0), 1e-9)
  const leftPct = row.left !== null ? (Math.abs(row.left) / denom) * 100 : 0
  const rightPct = row.right !== null ? (Math.abs(row.right) / denom) * 100 : 0

  return (
    <div className="grid grid-cols-[152px_48px_1fr_48px_60px] items-center gap-2 py-1 text-[12.5px]">
      <span className="truncate text-muted-foreground" title={def.label}>
        {def.label}
      </span>
      <span className="text-right tabular-nums text-muted-foreground">
        {formatMetric(def, row.left)}
      </span>
      <div className="flex h-4 flex-1 items-center">
        <div className="flex flex-1 justify-end">
          {row.left !== null && (
            <div
              className="h-2 rounded-l-[4px] bg-chart-left"
              style={{ width: `${leftPct}%` }}
            />
          )}
        </div>
        <div className="h-3 w-px shrink-0 bg-border-strong" />
        <div className="flex flex-1 justify-start">
          {row.right !== null && (
            <div
              className="h-2 rounded-r-[4px] bg-chart-right"
              style={{ width: `${rightPct}%` }}
            />
          )}
        </div>
      </div>
      <span className="tabular-nums text-muted-foreground">{formatMetric(def, row.right)}</span>
      <span className="text-right">
        {row.value === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <StatusChip state={isNotable(row) ? 'warn' : 'idle'} className="px-1.5 py-0.5">
            {formatAsymmetryValue(def, row)}
          </StatusChip>
        )}
      </span>
    </div>
  )
}

function TestAsymmetryBlock({
  def,
  pairs,
  subject,
}: {
  def: TestDefinition
  pairs: HandPair[]
  subject: Subject
}) {
  const [dayKey, setDayKey] = useState(pairs[0]!.dayKey)
  const pair = pairs.find((p) => p.dayKey === dayKey) ?? pairs[0]!
  const rows = asymmetryForPair(pair)
  const unpaired = pair.left === null || pair.right === null
  const dominant = subject.dominantHand || null

  return (
    <Card className="mb-4" data-testid="asymmetry-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{def.title} — L/R asymmetry</CardTitle>
        {pairs.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {pairs.map((p) => (
              <button
                key={p.dayKey}
                type="button"
                onClick={() => setDayKey(p.dayKey)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs',
                  p.dayKey === dayKey
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border text-muted-foreground hover:border-border-strong',
                )}
              >
                {dayLabel(p.dayKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block size-2 rounded-full bg-chart-left" /> Left
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-2 rounded-full bg-chart-right" /> Right
        </span>
        <span>
          Positive = right larger{dominant ? ` · dominant hand: ${dominant}` : ''}
        </span>
      </div>

      {unpaired ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Unpaired — {pair.left ? 'left' : 'right'} hand only on {dayLabel(pair.dayKey)}.
        </p>
      ) : null}

      <div className="mt-2 flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <BarRow key={row.key} row={row} />
        ))}
      </div>
    </Card>
  )
}

export function AsymmetryCard({
  results,
  subject,
}: {
  results: StoredResult[]
  subject: Subject
}) {
  const blocks = TEST_DEFS.map((def) => ({ def, pairs: pairResults(results, def.id) })).filter(
    (b) => b.pairs.length > 0,
  )
  if (blocks.length === 0) return null
  return (
    <>
      {blocks.map(({ def, pairs }) => (
        <TestAsymmetryBlock key={def.id} def={def} pairs={pairs} subject={subject} />
      ))}
    </>
  )
}
