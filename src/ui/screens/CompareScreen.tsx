// Result-to-result comparison: a catalog-driven delta table always, plus
// t=0-rebased overlaid charts when both results are the same test. Loads by
// id (not live objects) so a result deleted out from under this screen is
// detectable — it navigates back to the subject with a notice instead of
// rendering on stale/missing data.

import { useEffect, useRef, useState } from 'react'
import { deltaTone, formatDelta, formatMetric } from '../../analysis/metricCatalog'
import { buildCompare } from '../../analysis/compare'
import { testDefById } from '../../protocol/definitions'
import { getResult, getSubject, type StoredResult, type Subject } from '../../store/subjects'
import { OverlayEventChart, OverlaySignalChart } from '../charts/charts'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { useNav } from '../nav'

function resultLabel(r: StoredResult): string {
  const def = testDefById(r.testId)
  const hand = r.hand === 'left' ? 'L' : 'R'
  return `${def?.title ?? r.testId} · ${hand} · ${new Date(r.startedAt).toLocaleString()}`
}

export function CompareScreen({
  subjectId,
  aId,
  bId,
}: {
  subjectId: string
  aId: string
  bId: string
}) {
  const { navigate } = useNav()
  const [subject, setSubject] = useState<Subject | null | 'missing'>(null)
  const [resultA, setResultA] = useState<StoredResult | null | 'missing'>(null)
  const [resultB, setResultB] = useState<StoredResult | null | 'missing'>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([getSubject(subjectId), getResult(aId), getResult(bId)]).then(
      ([s, a, b]) => {
        if (!alive) return
        setSubject(s ?? 'missing')
        setResultA(a ?? 'missing')
        setResultB(b ?? 'missing')
      },
    )
    return () => {
      alive = false
    }
  }, [subjectId, aId, bId])

  // One-shot: if either result vanished (deleted elsewhere), bounce back to
  // the subject with a notice instead of rendering on missing data. Guarded
  // against StrictMode's double-invoked effects.
  const bouncedRef = useRef(false)
  useEffect(() => {
    if (bouncedRef.current) return
    if (resultA === 'missing' || resultB === 'missing') {
      bouncedRef.current = true
      navigate({ name: 'subject', subjectId, notice: 'A compared result was deleted.' })
    }
  }, [resultA, resultB, subjectId, navigate])

  if (subject === null || resultA === null || resultB === null) {
    return <p className="p-6 text-muted-foreground">Loading…</p>
  }
  if (subject === 'missing') {
    return <p className="p-6 text-muted-foreground">Subject not found.</p>
  }
  if (resultA === 'missing' || resultB === 'missing') {
    return <p className="p-6 text-muted-foreground">Result no longer exists…</p>
  }

  const cmp = buildCompare(resultA, resultB)
  const defA = testDefById(resultA.testId)

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <PageHeader
        title="Compare results"
        description={`${subject.code} — ${resultLabel(resultA)}  vs  ${resultLabel(resultB)}`}
        actions={
          <Button variant="ghost" onClick={() => navigate({ name: 'subject', subjectId })}>
            ← {subject.code}
          </Button>
        }
      />

      <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <i className="inline-block size-2 rounded-full bg-chart-left" /> A — {resultLabel(resultA)}
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block size-2 rounded-full bg-chart-right" /> B — {resultLabel(resultB)}
        </span>
      </div>

      {!cmp.sameTest && (
        <p className="mb-4 rounded-xl border border-warn/45 bg-warn-surface px-3.5 py-2.5 text-[13.5px] text-warn">
          Different tests — signal overlays are disabled; the table below still compares any
          shared metrics.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border bg-surface">
        <div className="grid grid-cols-[1fr_90px_90px_90px] gap-2 border-b bg-surface-2 px-3.5 py-2 text-xs font-medium text-muted-foreground">
          <span>Metric</span>
          <span className="text-right">A</span>
          <span className="text-right">B</span>
          <span className="text-right">Δ (B−A)</span>
        </div>
        {cmp.rows.map((row) => {
          const tone = deltaTone(row, row.delta)
          return (
            <div
              key={row.key}
              className="grid grid-cols-[1fr_90px_90px_90px] items-center gap-2 border-b px-3.5 py-2 text-[13px] last:border-b-0"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="text-right tabular-nums">{formatMetric(row, row.a)}</span>
              <span className="text-right tabular-nums">{formatMetric(row, row.b)}</span>
              <span
                className={
                  'text-right tabular-nums ' +
                  (tone === 'good' ? 'text-ok' : tone === 'bad' ? 'text-danger' : 'text-muted-foreground')
                }
              >
                {formatDelta(row, row.delta)}
              </span>
            </div>
          )
        })}
      </div>

      {cmp.sameTest && cmp.signals && cmp.amplitudes && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-[0.8px] text-muted-foreground">
            Signal
          </h3>
          <OverlaySignalChart
            a={cmp.signals.a}
            b={cmp.signals.b}
            yLabel={defA?.signalLabel ?? 'signal'}
          />
          <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-[0.8px] text-muted-foreground">
            Amplitude per event
          </h3>
          <OverlayEventChart
            a={cmp.amplitudes.a}
            b={cmp.amplitudes.b}
            yLabel="amplitude (hand units)"
          />
        </>
      )}
    </div>
  )
}
