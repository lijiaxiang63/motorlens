// Family-agnostic results-screen machinery: report building + __lastReport,
// the exactly-once subject-mode auto-save (savedRef survives StrictMode's
// double-invoked effects), the debounced notes editor, "vs previous" deltas,
// and the reference-cue thresholds load. Every family's results view calls
// this hook and renders its own layout around it.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MetricKey } from '../../../analysis/metricCatalog'
import {
  DEFAULT_REFERENCE_THRESHOLDS,
  type ReferenceThresholds,
} from '../../../analysis/thresholds'
import { deltasVsPrevious } from '../../../analysis/trends'
import { buildSessionReport } from '../../../report/export'
import {
  getReferenceThresholds,
  getResult,
  listResults,
  newId,
  saveResult,
  saveVideo,
  subjectToReportSubject,
} from '../../../store/subjects'
import type { SessionReport } from '../../../types'
import type { ResultProps } from '../../nav'

export interface ResultSession {
  report: SessionReport
  durationMs: number
  resultId: string | null
  savedChip: { state: 'ok' | 'err'; text: string } | null
  notes: string
  handleNotesChange(text: string): void
  flushNotes(): void
  deltas: Partial<Record<MetricKey, number | null>> | null
  thresholds: ReferenceThresholds
}

export function useResultSession(r: ResultProps): ResultSession {
  const { def, hand, analysis } = r
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
      setDeltas(deltasVsPrevious(analysis.metrics, priors))
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- r/def/hand are fixed for this screen's lifetime (remounts on navigate)
  }, [])

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

  return {
    report,
    durationMs,
    resultId,
    savedChip,
    notes,
    handleNotesChange,
    flushNotes,
    deltas,
    thresholds,
  }
}
