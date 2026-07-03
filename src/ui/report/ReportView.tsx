// Loads a session or subject report model from IndexedDB, snapshots the
// session's charts (light-locked, see chartSnapshots.ts), and renders the
// static print document. Deliberately has no dependency on NavProvider/
// useNav — it's used both as a normal in-app route (wrapped by
// ReportScreen, which adds navigation chrome) and standalone inside
// Electron's hidden print window (see src/main.tsx), which has no router at
// all. `window.__reportReady` / `window.motorlens.reportReady()` fire once,
// after fonts are loaded and the document (including any chart images) has
// painted — the signal both the e2e harness and Electron's printToPDF flow
// wait on.

import { useEffect, useRef, useState } from 'react'
import {
  buildSessionReportModel,
  buildSubjectReportModel,
  type SessionReportModel,
  type SubjectReportModel,
} from '../../report/clinical'
import {
  getReferenceThresholds,
  getResult,
  getSubject,
  listResults,
} from '../../store/subjects'
import { createEventChart, createSignalChart } from '../charts/uplotCore'
import { snapshotChart } from './chartSnapshots'
import { SessionReportDocument, SubjectReportDocument } from './ReportDocument'
import './report.css'

type ViewState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'session'; model: SessionReportModel; pngs: Record<string, string> }
  | { status: 'subject'; model: SubjectReportModel }

async function loadSession(
  id: string,
): Promise<{ model: SessionReportModel; pngs: Record<string, string> } | null> {
  const [result, thresholds] = await Promise.all([getResult(id), getReferenceThresholds()])
  if (!result) return null
  const subject = (await getSubject(result.subjectId)) ?? null
  const model = buildSessionReportModel(result, subject, thresholds)
  if (!model) return null

  // Sequential — snapshotChart's off-layout host is single-use per call, and
  // running these concurrently gives no benefit worth the added complexity.
  const charts = model.charts
  const pngs: Record<string, string> = {}
  if (charts.kind === 'cycle') {
    pngs.signal = await snapshotChart((el, palette) =>
      createSignalChart(el, charts.signal, charts.events, charts.signalLabel, 220, palette),
    )
    pngs.amplitude = await snapshotChart((el, palette) =>
      createEventChart(el, charts.amplitudes, charts.amplitudeLabel, { trend: true, palette }),
    )
  } else {
    // rom: per-finger bars and the joint table render as print-safe HTML;
    // only the flexion trace needs a canvas snapshot.
    pngs.trace = await snapshotChart((el, palette) =>
      createSignalChart(el, charts.trace, [], charts.traceLabel, 220, palette),
    )
  }
  return { model, pngs }
}

async function loadSubject(id: string): Promise<SubjectReportModel | null> {
  const [subject, thresholds] = await Promise.all([getSubject(id), getReferenceThresholds()])
  if (!subject) return null
  const results = await listResults(id)
  return buildSubjectReportModel(subject, results, thresholds)
}

export function ReportView({
  kind,
  id,
  onNotFound,
}: {
  kind: 'session' | 'subject'
  id: string
  onNotFound?: () => void
}) {
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    void (async () => {
      if (kind === 'session') {
        const loaded = await loadSession(id)
        if (!alive) return
        setState(loaded ? { status: 'session', ...loaded } : { status: 'not-found' })
      } else {
        const model = await loadSubject(id)
        if (!alive) return
        setState(model ? { status: 'subject', model } : { status: 'not-found' })
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kind/id are fixed for this view's lifetime (remounts on navigate)
  }, [])

  const notFoundRef = useRef(false)
  useEffect(() => {
    if (state.status !== 'not-found' || notFoundRef.current) return
    notFoundRef.current = true
    onNotFound?.()
  }, [state.status, onNotFound])

  // One-shot ready signal once the document (including chart images, for the
  // session kind) has rendered and fonts have settled — guarded against
  // StrictMode's double-invoked effects.
  const readyRef = useRef(false)
  useEffect(() => {
    if (readyRef.current) return
    if (state.status !== 'session' && state.status !== 'subject') return
    readyRef.current = true
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        ;(window as unknown as Record<string, unknown>).__reportReady = true
        window.motorlens?.reportReady?.()
      })
    })
  }, [state.status])

  if (state.status === 'loading') {
    return (
      <div className="report-light flex min-h-[300px] items-center justify-center bg-background text-muted-foreground">
        Loading report…
      </div>
    )
  }
  if (state.status === 'not-found') {
    return (
      <div className="report-light flex min-h-[300px] items-center justify-center bg-background text-muted-foreground">
        Report not found — the result or subject may have been deleted.
      </div>
    )
  }
  if (state.status === 'session') {
    return <SessionReportDocument model={state.model} pngs={state.pngs} />
  }
  return <SubjectReportDocument model={state.model} />
}
