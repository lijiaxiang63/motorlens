// Results: metric cards, quality warnings, and three charts (signal with
// closure markers, per-event amplitude with trend, inter-event intervals).
// In subject mode the result auto-saves to IndexedDB exactly once — the
// `savedRef` guard survives StrictMode's double-invoked effects.

import { useEffect, useMemo, useRef, useState } from 'react'
import { deltaTone, formatDelta, metricByKey, type MetricKey } from '../../analysis/metricCatalog'
import { DEFAULT_REFERENCE_THRESHOLDS, evaluateThreshold } from '../../analysis/thresholds'
import { deltasVsPrevious } from '../../analysis/trends'
import { HAND_SCALE_CV_WARN_PCT } from '../../config'
import { buildSessionReport, downloadReport } from '../../report/export'
import {
  getReferenceThresholds,
  getResult,
  getSaveVideoSetting,
  listResults,
  newId,
  saveResult,
  saveVideo,
  subjectToReportSubject,
} from '../../store/subjects'
import { SignalChart, EventChart } from '../charts/charts'
import { MetricCard, type MetricDelta } from '../components/MetricCard'
import { PageHeader } from '../components/PageHeader'
import { StatusChip } from '../components/StatusChip'
import { Button } from '../components/ui/button'
import { Card, CardDescription, CardTitle } from '../components/ui/card'
import { Textarea } from '../components/ui/field'
import { fmt } from '../format'
import { useNav, type ResultProps } from '../nav'

export function ResultsScreen({ result: r }: { result: ResultProps }) {
  const { navigate } = useNav()
  const { def, hand, analysis } = r
  const m = analysis.metrics
  const q = analysis.quality
  const durationMs = r.durationMs ?? def.durationMs

  const report = useMemo(
    () =>
      buildSessionReport({
        test: def.id,
        hand,
        startedAt: r.startedAt,
        durationMs,
        analysis,
        frames: r.frames,
        ...(r.subject ? { subject: subjectToReportSubject(r.subject) } : {}),
        ...(r.source ? { source: r.source } : {}),
      }),
    [r, def, hand, analysis, durationMs],
  )

  // Exposed for automated verification and debugging.
  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).__lastReport = report
  }, [report])

  // --- subject-mode auto-save (exactly once; viewing saved results skips) ---
  const savedRef = useRef(false)
  const [savedChip, setSavedChip] = useState<{ state: 'ok' | 'err'; text: string } | null>(null)
  // The stored result's id — retained (not just minted-and-discarded) so the
  // notes editor below has something to persist against. Seeded from
  // savedResultId when reopening an already-stored result.
  const [resultId, setResultId] = useState<string | null>(r.savedResultId ?? null)
  const resultIdRef = useRef(resultId)
  useEffect(() => {
    resultIdRef.current = resultId
  }, [resultId])
  useEffect(() => {
    if (!r.subject || r.savedResultId || savedRef.current) return
    savedRef.current = true
    const subject = r.subject
    const newResultId = newId()
    void (async () => {
      let videoKey: string | undefined
      if (r.capturedVideo) {
        try {
          videoKey = `live_${newResultId}`
          await saveVideo({
            key: videoKey,
            blob: r.capturedVideo.blob,
            mimeType: r.capturedVideo.mimeType,
          })
        } catch {
          videoKey = undefined // quota etc. — keep the result anyway
        }
      }
      await saveResult({
        id: newResultId,
        subjectId: subject.id,
        testId: def.id,
        hand,
        source: r.source?.kind ?? 'live',
        startedAt: r.startedAt,
        ...(videoKey ? { videoKey } : {}),
        report,
      })
      setResultId(newResultId)
      setSavedChip({
        state: 'ok',
        text: `Saved to ${subject.code}${videoKey ? ' · video kept' : ''}`,
      })
    })().catch((err: unknown) => {
      setSavedChip({
        state: 'err',
        text: `Not saved: ${err instanceof Error ? err.message : String(err)}`,
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- notes editor — debounced persistence via get→mutate report.notes→
  // saveResult; idempotent (idbPut upserts), so no StrictMode ref guard is
  // needed. `resultIdRef`/`notesRef` hold the latest values so the mount-time
  // unmount-cleanup closure below never reads stale data. ---
  const [notes, setNotesState] = useState(r.notes ?? '')
  const notesRef = useRef(notes)
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function persistNotes(text: string) {
    const id = resultIdRef.current
    if (!id) return // quick test (no subject) — nothing to persist against yet
    const row = await getResult(id)
    if (!row) return
    if (text) row.report.notes = text
    else delete row.report.notes
    await saveResult(row)
  }

  function flushNotes() {
    if (notesTimerRef.current) {
      clearTimeout(notesTimerRef.current)
      notesTimerRef.current = null
    }
    void persistNotes(notesRef.current)
  }

  function handleNotesChange(text: string) {
    notesRef.current = text
    setNotesState(text)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(() => void persistNotes(text), 600)
  }

  useEffect(() => {
    return () => flushNotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- "vs previous session" delta chips (read-only; safe under StrictMode's
  // double-invoked effects, unlike the auto-save effect above) ---
  const [deltas, setDeltas] = useState<Partial<Record<MetricKey, number | null>> | null>(null)
  useEffect(() => {
    if (!r.subject) return
    const subjectId = r.subject.id
    let alive = true
    void listResults(subjectId).then((all) => {
      if (!alive) return
      const priors = all.filter(
        (x) =>
          x.testId === def.id &&
          x.hand === hand &&
          x.startedAt < r.startedAt &&
          x.id !== r.savedResultId,
      )
      setDeltas(deltasVsPrevious(m, priors))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- r/def/hand/m are fixed for this screen's lifetime (remounts on navigate)
  }, [])

  function chipFor(key: MetricKey): MetricDelta | undefined {
    const delta = deltas?.[key]
    if (delta == null) return undefined
    const chipDef = metricByKey(key)
    const tone = deltaTone(chipDef, delta)
    if (!tone) return undefined
    return { text: formatDelta(chipDef, delta), tone }
  }

  // --- reference-cue flags (read-only load; initialized to the shipped
  // defaults so a metric card never briefly renders unflagged while the
  // IDB read is in flight) ---
  const [thresholds, setThresholds] = useState(DEFAULT_REFERENCE_THRESHOLDS)
  useEffect(() => {
    let alive = true
    void getReferenceThresholds().then((t) => {
      if (alive) setThresholds(t)
    })
    return () => {
      alive = false
    }
  }, [])

  function flaggedTone(key: MetricKey): 'warn' | undefined {
    const value = metricByKey(key).getter(m)
    return evaluateThreshold(thresholds[key], value) ? 'warn' : undefined
  }

  // --- quality warnings ---
  const warnings: string[] = []
  if (q.detectionRate < 0.9) {
    warnings.push(
      `Hand tracking was lost for ${(100 - q.detectionRate * 100).toFixed(0)}% of the test — results may be incomplete.`,
    )
  }
  if (q.handScaleCvPct > HAND_SCALE_CV_WARN_PCT) {
    warnings.push(
      `Hand position varied a lot during the test (scale CV ${q.handScaleCvPct.toFixed(0)}%) — for best tracking, keep a steady distance from the camera.`,
    )
  }
  if (q.meanFps < 15) {
    warnings.push(
      `Low frame rate (${q.meanFps.toFixed(0)} fps) — fast movements may be undersampled.`,
    )
  }
  if (m.count < 4) {
    warnings.push('Very few events detected — decrement and rhythm metrics need more repetitions.')
  }
  if (r.videoCaptureFailed) {
    warnings.push('Video capture failed on this device — the result was saved without a video.')
  }

  // --- metric cards ---
  const noun = def.eventNoun[1]
  const cmSub = (units: number | null, digits = 1) =>
    units !== null && m.cmPerUnit !== null
      ? `≈ ${(units * m.cmPerUnit).toFixed(digits)} cm`
      : undefined
  const cmVelSub = (units: number | null) =>
    units !== null && m.cmPerUnit !== null
      ? `≈ ${(units * m.cmPerUnit).toFixed(0)} cm/s`
      : undefined

  const itis = useMemo(() => {
    const out: number[] = []
    for (let i = 1; i < analysis.events.length; i++) {
      const a = analysis.events[i - 1]!
      const b = analysis.events[i]!
      if (a.segment === b.segment) out.push(b.tMs - a.tMs)
    }
    return out
  }, [analysis.events])

  const amplitudes = useMemo(
    () => analysis.events.map((e) => e.closingAmplitude),
    [analysis.events],
  )

  async function repeatTest() {
    if (r.subject) {
      const saveVideoPref = await getSaveVideoSetting().catch(() => true)
      navigate({
        name: 'record',
        def,
        hand,
        subjectCtx: { subject: r.subject, saveVideo: saveVideoPref },
      })
    } else {
      navigate({ name: 'record', def, hand })
    }
  }

  const startedDate = new Date(r.startedAt)
  const subjectBit = r.subject ? `${r.subject.code} · ` : ''
  const sourceBit = r.source?.kind === 'video' ? ` · from ${r.source.fileName ?? 'video file'}` : ''

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <PageHeader
        className="mb-4"
        title={`${def.title} — results`}
        description={
          <>
            {subjectBit}
            {hand === 'left' ? 'Left' : 'Right'} hand · {startedDate.toLocaleString()} ·{' '}
            {fmt(q.meanFps, 0)} fps · {(q.detectionRate * 100).toFixed(0)}% detection
            {sourceBit}
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => void downloadReport(notes ? { ...report, notes } : report)}
            >
              Export JSON
            </Button>
            <Button variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="ghost" onClick={() => void repeatTest()}>
              Repeat test
            </Button>
            {r.subject && (
              <Button
                variant="primary"
                onClick={() => navigate({ name: 'subject', subjectId: r.subject!.id })}
              >
                Next test →
              </Button>
            )}
            <Button
              variant={r.subject ? 'ghost' : 'primary'}
              onClick={() => navigate({ name: 'home' })}
            >
              Home
            </Button>
          </>
        }
      >
        {savedChip && (
          <StatusChip state={savedChip.state} className="mt-1.5">
            {savedChip.text}
          </StatusChip>
        )}
      </PageHeader>

      {warnings.length > 0 && (
        <div className="mb-4 flex flex-col gap-1 rounded-xl border border-warn/45 bg-warn-surface px-3.5 py-2.5 text-[13.5px] text-warn">
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <MetricCard
          label={noun}
          value={String(m.count)}
          sub={`in ${(durationMs / 1000).toFixed(durationMs % 1000 === 0 ? 0 : 1)} s`}
          tone={flaggedTone('count') ?? 'accent'}
          delta={chipFor('count')}
        />
        <MetricCard
          label="Frequency"
          value={fmt(m.frequencyHz, 2, ' Hz')}
          tone={flaggedTone('frequencyHz')}
          delta={chipFor('frequencyHz')}
        />
        <MetricCard
          label="Amplitude (mean)"
          value={fmt(m.amplitudeMean, 2)}
          sub={cmSub(m.amplitudeMean)}
          tone={flaggedTone('amplitudeMean')}
          delta={chipFor('amplitudeMean')}
        />
        <MetricCard
          label="Amplitude (max)"
          value={fmt(m.amplitudeMax, 2)}
          sub={cmSub(m.amplitudeMax)}
          tone={flaggedTone('amplitudeMax')}
          delta={chipFor('amplitudeMax')}
        />
        <MetricCard
          label={`${def.closingLabel} (mean)`}
          value={fmt(m.closingVelMean, 1, ' u/s')}
          sub={cmVelSub(m.closingVelMean)}
          tone={flaggedTone('closingVelMean')}
          delta={chipFor('closingVelMean')}
        />
        <MetricCard
          label={`${def.closingLabel} (peak)`}
          value={fmt(m.closingVelPeak, 1, ' u/s')}
          sub={cmVelSub(m.closingVelPeak)}
          tone={flaggedTone('closingVelPeak')}
          delta={chipFor('closingVelPeak')}
        />
        <MetricCard
          label={`${def.openingLabel} (mean)`}
          value={fmt(m.openingVelMean, 1, ' u/s')}
          sub={cmVelSub(m.openingVelMean)}
          tone={flaggedTone('openingVelMean')}
          delta={chipFor('openingVelMean')}
        />
        <MetricCard
          label="Amplitude decrement"
          value={fmt(m.amplitudeDecrement.regressionPct, 0, '%')}
          sub={
            m.amplitudeDecrement.thirdsPct !== null
              ? `thirds: ${fmt(m.amplitudeDecrement.thirdsPct, 0, '%')}`
              : undefined
          }
          tone={flaggedTone('ampDecrementPct')}
          delta={chipFor('ampDecrementPct')}
        />
        <MetricCard
          label="Velocity decrement"
          value={fmt(m.velocityDecrement.regressionPct, 0, '%')}
          tone={flaggedTone('velDecrementPct')}
          delta={chipFor('velDecrementPct')}
        />
        <MetricCard
          label="Rhythm variability"
          value={fmt(m.rhythm.itiCvPct, 0, '%')}
          sub="CV of intervals"
          tone={flaggedTone('itiCvPct')}
          delta={chipFor('itiCvPct')}
        />
        <MetricCard
          label="Hesitations"
          value={String(m.rhythm.hesitationCount)}
          sub={
            m.rhythm.longestPauseMs !== null
              ? `longest pause ${fmt(m.rhythm.longestPauseMs / 1000, 2, ' s')}`
              : undefined
          }
          tone={flaggedTone('hesitationCount')}
          delta={chipFor('hesitationCount')}
        />
        <MetricCard
          label="Mean interval"
          value={fmt(m.rhythm.itiMeanMs, 0, ' ms')}
          tone={flaggedTone('itiMeanMs')}
          delta={chipFor('itiMeanMs')}
        />
      </div>

      <SectionTitle>Signal</SectionTitle>
      <SignalChart series={analysis.signal} events={analysis.events} yLabel={def.signalLabel} />

      <div className="grid grid-cols-2 gap-4 min-w-0-children max-[900px]:grid-cols-1">
        <div>
          <SectionTitle>Amplitude per event</SectionTitle>
          <EventChart values={amplitudes} yLabel="amplitude (hand units)" trend />
        </div>
        <div>
          <SectionTitle>Interval per event</SectionTitle>
          <EventChart values={itis} yLabel="interval (ms)" />
        </div>
      </div>

      <Card className="mt-5">
        <CardTitle>Notes</CardTitle>
        <Textarea
          className="mt-2"
          rows={3}
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          onBlur={flushNotes}
          placeholder="Optional note for this session…"
        />
        <CardDescription>
          {resultId ? 'Saved with this result.' : 'Included in the exported JSON for this session.'}
        </CardDescription>
      </Card>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-[0.8px] text-muted-foreground">
      {children}
    </h3>
  )
}
