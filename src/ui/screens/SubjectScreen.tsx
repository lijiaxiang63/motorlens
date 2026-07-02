// Subject detail: info header, test checklist (the batch-session workbench),
// saved results, and entry points for recording and video upload.

import { Check, FileVideo, Minus, Pencil, Trash2, Video, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TEST_DEFS, testDefById } from '../../protocol/definitions'
import {
  deleteResult,
  deleteSubject,
  getSaveVideoSetting,
  getSubject,
  listResults,
  saveSubject,
  setSaveVideoSetting,
  type StoredResult,
  type Subject,
} from '../../store/subjects'
import type { CycleTestMetrics, Hand } from '../../types'
import { Button } from '../components/ui/button'
import { Card, CardDescription, CardFooter, CardTitle } from '../components/ui/card'
import { CheckboxRow } from '../components/ui/field'
import { ConfirmDialog } from '../components/ui/alert-dialog'
import { SubjectForm } from '../components/SubjectForm'
import { fmt } from '../format'
import { useNav } from '../nav'

const HANDS: readonly Hand[] = ['left', 'right']

function cycleMetrics(r: StoredResult): CycleTestMetrics | null {
  const m = r.report.metrics as CycleTestMetrics
  return typeof m.count === 'number' ? m : null
}

function metricsSnippet(r: StoredResult): string {
  const def = testDefById(r.testId)
  const m = cycleMetrics(r)
  if (!def || !m) return ''
  return `${m.count} ${def.eventNoun[1]} · ${fmt(m.frequencyHz, 2)} Hz`
}

function metaLine(s: Subject): string {
  const parts: string[] = []
  if (s.sex) parts.push(s.sex)
  if (s.birthYear !== null) {
    parts.push(`b. ${s.birthYear} (${new Date().getFullYear() - s.birthYear} y)`)
  }
  if (s.dominantHand) parts.push(`${s.dominantHand}-handed`)
  if (s.diagnosis) parts.push(s.diagnosis)
  return parts.join(' · ')
}

export function SubjectScreen({ subjectId, notice }: { subjectId: string; notice?: string }) {
  const { navigate } = useNav()
  const [subject, setSubject] = useState<Subject | null | 'missing'>(null)
  const [results, setResults] = useState<StoredResult[]>([])
  const [saveVideo, setSaveVideo] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [noticeShown, setNoticeShown] = useState(notice != null)
  const [confirmDeleteSubject, setConfirmDeleteSubject] = useState(false)
  const [confirmDeleteResult, setConfirmDeleteResult] = useState<StoredResult | null>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const showError = useCallback((err: unknown) => {
    if (alive.current) setError(String(err instanceof Error ? err.message : err))
  }, [])

  const load = useCallback(async () => {
    try {
      const [s, rs, sv] = await Promise.all([
        getSubject(subjectId),
        listResults(subjectId),
        getSaveVideoSetting(),
      ])
      if (!alive.current) return
      setSubject(s ?? 'missing')
      setResults(rs)
      setSaveVideo(sv)
    } catch (err) {
      showError(err)
    }
  }, [subjectId, showError])

  useEffect(() => {
    void load()
  }, [load])

  if (subject === null) {
    return <p className="p-6 text-muted-foreground">Loading…</p>
  }
  if (subject === 'missing') {
    return <p className="p-6 text-muted-foreground">Subject not found.</p>
  }
  const s = subject

  const subjectCtx = { subject: s, saveVideo }

  // Battery checklist rows with the first pending row accented.
  let firstPendingMarked = false
  const checklistRows = TEST_DEFS.flatMap((def) =>
    HANDS.map((hand) => {
      const matches = results.filter((r) => r.testId === def.id && r.hand === hand)
      const latest = matches[0] // results sorted newest-first
      const pending = matches.length === 0
      const accent = pending && !firstPendingMarked
      if (accent) firstPendingMarked = true
      return { def, hand, matches, latest, pending, accent }
    }),
  )

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight">
            {s.name ? `${s.code} — ${s.name}` : s.code}
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {metaLine(s) || 'No details recorded'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => navigate({ name: 'subjects' })}>
            ← Subjects
          </Button>
          <Button variant="ghost" onClick={() => setEditing((v) => !v)}>
            <Pencil /> Edit
          </Button>
          <Button variant="ghost-danger" onClick={() => setConfirmDeleteSubject(true)}>
            <Trash2 /> Delete subject
          </Button>
        </div>
      </header>

      {noticeShown && notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-ok/45 bg-ok-surface px-3.5 py-2.5 text-[13.5px] text-ok">
          <span>{notice}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setNoticeShown(false)}>
            <X />
          </Button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-danger/45 bg-danger-surface p-3.5 text-sm">
          <strong>Storage error: </strong>
          {error}
        </div>
      )}

      {editing && (
        <SubjectForm
          initial={s}
          onSave={async (updated) => {
            await saveSubject(updated)
            setSubject(updated)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <Card className="mb-4">
        <CardTitle>Test battery</CardTitle>
        <CheckboxRow
          checked={saveVideo}
          onChange={(v) => {
            setSaveVideo(v)
            void setSaveVideoSetting(v).catch(() => {})
          }}
          className="mt-2"
        >
          Save camera video with each test (for later human review)
        </CheckboxRow>
        <div className="mt-2.5 flex flex-col gap-2">
          {checklistRows.map(({ def, hand, matches, latest, pending, accent }) => (
            <div
              key={`${def.id}-${hand}`}
              className={
                'flex items-center gap-3 rounded-[10px] border bg-surface-2 px-3 py-2.5' +
                (accent ? ' border-accent/55' : '')
              }
            >
              <span
                className={
                  'flex w-11 items-center justify-center gap-0.5 whitespace-nowrap text-[13px] font-semibold ' +
                  (pending ? 'text-muted-foreground' : 'text-ok')
                }
              >
                {pending ? (
                  <Minus className="size-4" />
                ) : (
                  <>
                    <Check className="size-4" />
                    {matches.length > 1 ? `×${matches.length}` : ''}
                  </>
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px]">
                  {def.title} — {hand === 'left' ? 'Left' : 'Right'} hand
                </span>
                {latest && (
                  <span className="text-xs text-muted-foreground">{metricsSnippet(latest)}</span>
                )}
              </div>
              <Button
                variant={pending ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => navigate({ name: 'record', def, hand, subjectCtx })}
              >
                {pending ? 'Start' : 'Redo'}
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4">
        <CardTitle>Analyze a video file</CardTitle>
        <CardDescription>
          Upload a recording of finger tapping and/or fist open–close — one hand at a time (e.g.
          left hand first, then right). Segments are detected automatically and can be corrected
          before analysis.
        </CardDescription>
        <CardFooter>
          <span className="text-xs text-muted-foreground">mp4 / webm / mov</span>
          <Button variant="ghost" onClick={() => uploadRef.current?.click()}>
            <FileVideo /> Choose video…
          </Button>
        </CardFooter>
        <input
          ref={uploadRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) navigate({ name: 'videoReview', subject: s, file })
          }}
        />
      </Card>

      <h3 className="mb-2 mt-5 text-sm font-semibold uppercase tracking-[0.8px] text-muted-foreground">
        Results{results.length > 0 ? ` (${results.length})` : ''}
      </h3>
      {results.length === 0 ? (
        <p className="text-muted-foreground">No results yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {results.map((r) => {
            const def = testDefById(r.testId)
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-4 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                  <span
                    className={
                      'rounded-[5px] border px-1.5 py-0.5 text-[10.5px] tracking-[1px] ' +
                      (r.source === 'live' ? 'border-ok/40 text-ok' : 'border-accent/40 text-accent')
                    }
                  >
                    {r.source === 'live' ? 'LIVE' : 'VIDEO'}
                  </span>
                  <strong className="text-[13.5px]">
                    {def?.title ?? r.testId} · {r.hand === 'left' ? 'L' : 'R'}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </span>
                  {r.videoKey && <Video className="size-3.5 text-muted-foreground" aria-label="video saved" />}
                </div>
                <span className="text-xs text-muted-foreground">{metricsSnippet(r)}</span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (!def) return
                      // Recompute from stored raw frames — same regression
                      // harness as the JSON import path.
                      const frames = r.report.raw.frames
                      navigate({
                        name: 'results',
                        result: {
                          def,
                          hand: r.hand,
                          analysis: def.compute(frames),
                          frames,
                          startedAt: r.startedAt,
                          durationMs: r.report.durationMs,
                          subject: s,
                          ...(r.report.source ? { source: r.report.source } : {}),
                          savedResultId: r.id,
                        },
                      })
                    }}
                  >
                    View
                  </Button>
                  <Button variant="ghost-danger" size="sm" onClick={() => setConfirmDeleteResult(r)}>
                    Delete
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteSubject}
        onOpenChange={setConfirmDeleteSubject}
        title={`Delete subject ${s.code}?`}
        description="All of their results and saved videos are removed too. This cannot be undone."
        confirmLabel="Delete subject"
        destructive
        onConfirm={() => {
          void deleteSubject(s.id)
            .then(() => navigate({ name: 'subjects' }))
            .catch(showError)
        }}
      />
      <ConfirmDialog
        open={confirmDeleteResult !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteResult(null)
        }}
        title="Delete this result?"
        description="Its saved video (if any) is removed too."
        confirmLabel="Delete result"
        destructive
        onConfirm={() => {
          const r = confirmDeleteResult
          if (!r) return
          void deleteResult(r)
            .then(() => load())
            .catch(showError)
        }}
      />
    </div>
  )
}
