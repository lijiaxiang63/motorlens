// Video-upload analysis: run MediaPipe over the file (with progress), show
// auto-detected segments on a timeline for correction, then analyze each
// confirmed segment with the standard pipeline and save the results under
// the subject. Works without any FrameSource — the uploaded file is the
// only input.
//
// The lazy import('../../tracking/videoFile') keeps MediaPipe out of the
// main bundle (same rule as the camera source in main.tsx).

import { Plus, Trash2 } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { SEG_CONFIDENCE_WARN, SEG_MIN_SEGMENT_MS, VIDEO_WARN_DURATION_S } from '../../config'
import { detectSegments, sliceFrames, swapFramesHandedness } from '../../metrics/segments'
import { testDefById } from '../../protocol/definitions'
import { buildSessionReport } from '../../report/export'
import {
  newId,
  saveResult,
  saveVideo,
  subjectToReportSubject,
  type Subject,
} from '../../store/subjects'
import type { Hand, LandmarkFrame } from '../../types'
import { Button } from '../components/ui/button'
import { Card, CardTitle } from '../components/ui/card'
import { CheckboxRow, Field, Input, Select } from '../components/ui/field'
import { ConfirmDialog } from '../components/ui/alert-dialog'
import { fmtTime } from '../format'
import { useNav } from '../nav'
import {
  createSegmentTimeline,
  type EditableSegment,
  type SegmentTimeline,
} from '../segmentTimeline'
import { useTheme } from '../theme'

/** Probe just the duration (cheap metadata load) for the long-file gate. */
function probeDurationS(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    const done = (d: number | null) => {
      URL.revokeObjectURL(url)
      v.removeAttribute('src')
      resolve(d)
    }
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null)
    v.onerror = () => done(null)
    v.src = url
  })
}

type Stage =
  | { kind: 'probing' }
  | { kind: 'confirmLong'; durS: number }
  | { kind: 'processing'; fraction: number; tMs: number; durS: number | null }
  | { kind: 'review' }
  | { kind: 'analyzing'; index: number; total: number }
  | { kind: 'error'; message: string; backTo: 'subject' | 'review' }

export function VideoReviewScreen({ subject, file }: { subject: Subject; file: File }) {
  const { navigate } = useNav()
  const [stage, setStage] = useState<Stage>({ kind: 'probing' })
  const [segments, setSegments] = useState<EditableSegment[]>([])
  const [selected, setSelected] = useState(-1)
  const [swapped, setSwapped] = useState(false)
  const [keepVideo, setKeepVideo] = useState(true)
  const [confirmSwap, setConfirmSwap] = useState(false)
  const [confirmBack, setConfirmBack] = useState(false)
  const framesRef = useRef<LandmarkFrame[]>([])
  const [durationMs, setDurationMs] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const playerRef = useRef<HTMLVideoElement>(null)

  const playerUrl = useMemo(() => URL.createObjectURL(file), [file])
  useEffect(() => {
    return () => {
      playerRef.current?.pause()
      URL.revokeObjectURL(playerUrl)
    }
  }, [playerUrl])

  const backToSubject = useCallback(
    (notice?: string) => {
      navigate({ name: 'subject', subjectId: subject.id, ...(notice ? { notice } : {}) })
    },
    [navigate, subject.id],
  )

  const process = useCallback(
    async (durS: number | null) => {
      const abort = new AbortController()
      abortRef.current = abort
      setStage({ kind: 'processing', fraction: 0, tMs: 0, durS })
      try {
        const { processVideoFile } = await import('../../tracking/videoFile')
        const processed = await processVideoFile(
          file,
          (fraction, tMs) => {
            if (!abort.signal.aborted) setStage({ kind: 'processing', fraction, tMs, durS })
          },
          abort.signal,
        )
        if (abort.signal.aborted) return
        framesRef.current = processed.frames
        setDurationMs(processed.durationMs)
        setSegments(detectSegments(processed.frames))
        setStage({ kind: 'review' })
      } catch (err) {
        if (abort.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return
        }
        setStage({
          kind: 'error',
          message: String(err instanceof Error ? err.message : err),
          backTo: 'subject',
        })
      }
    },
    [file],
  )

  useEffect(() => {
    let cancelled = false
    void probeDurationS(file).then((durS) => {
      if (cancelled) return
      if (durS !== null && durS > VIDEO_WARN_DURATION_S) setStage({ kind: 'confirmLong', durS })
      else void process(durS)
    })
    return () => {
      cancelled = true
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [file, process])

  function segmentValid(s: EditableSegment): string | null {
    if (!(s.startMs < s.endMs)) return 'start must be before end'
    if (s.startMs < 0 || s.endMs > durationMs) return 'outside the video'
    return null
  }

  function editSegments(fn: (segs: EditableSegment[]) => EditableSegment[]) {
    setSegments((prev) => fn(prev.map((s) => ({ ...s }))).sort((a, b) => a.startMs - b.startMs))
  }

  async function analyze() {
    if (segments.length === 0) return
    const frames = framesRef.current
    const ordered = segments.slice().sort((a, b) => a.startMs - b.startMs)
    setStage({ kind: 'analyzing', index: 0, total: ordered.length })
    try {
      let videoKey: string | undefined
      if (keepVideo) {
        videoKey = `upload_${newId()}`
        try {
          await saveVideo({
            key: videoKey,
            blob: file,
            mimeType: file.type || 'video/mp4',
            fileName: file.name,
          })
        } catch {
          videoKey = undefined // quota — results still saved
        }
      }

      const startedBase = file.lastModified || Date.now()
      for (let i = 0; i < ordered.length; i++) {
        const seg = ordered[i]!
        setStage({ kind: 'analyzing', index: i, total: ordered.length })
        await new Promise((r) => setTimeout(r, 0)) // let the progress paint
        const def = testDefById(seg.testId)!
        const sliced = sliceFrames(frames, seg)
        const analysis = def.compute(sliced)
        const startedAt = new Date(startedBase + seg.startMs).toISOString()
        const report = buildSessionReport({
          test: def.id,
          hand: seg.hand,
          startedAt,
          durationMs: seg.endMs - seg.startMs,
          analysis,
          frames: sliced,
          subject: subjectToReportSubject(subject),
          source: {
            kind: 'video',
            fileName: file.name,
            segmentStartMs: Math.round(seg.startMs),
            segmentEndMs: Math.round(seg.endMs),
          },
        })
        await saveResult({
          id: newId(),
          subjectId: subject.id,
          testId: def.id,
          hand: seg.hand,
          source: 'video',
          startedAt,
          ...(videoKey ? { videoKey } : {}),
          report,
        })
      }
      backToSubject(
        `Added ${ordered.length} result${ordered.length === 1 ? '' : 's'} from ${file.name}`,
      )
    } catch (err) {
      setStage({
        kind: 'error',
        message: String(err instanceof Error ? err.message : err),
        backTo: 'review',
      })
    }
  }

  // ---------------------------------------------------------------- render

  const invalid = segments.filter((s) => segmentValid(s) !== null).length
  const sel = segments[selected]

  const header = (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-[20px] font-semibold tracking-tight">
          Video analysis — {subject.code}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {file.name}
          {stage.kind === 'review' &&
            ` · ${fmtTime(durationMs)} · ${segments.length} segment${segments.length === 1 ? '' : 's'} auto-detected`}
        </p>
      </div>
      <Button
        variant="ghost"
        onClick={() => {
          if (stage.kind !== 'review' || segments.length === 0) backToSubject()
          else setConfirmBack(true)
        }}
      >
        ← Subject
      </Button>
    </header>
  )

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      {header}

      {(stage.kind === 'probing' || stage.kind === 'processing') && (
        <Card className="mx-auto my-10 flex max-w-[640px] flex-col gap-3.5">
          <CardTitle>Detecting hand movements…</CardTitle>
          {stage.kind === 'processing' && (
            <div className="flex items-center gap-3">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${(stage.fraction * 100).toFixed(1)}%` }}
                />
              </div>
              <span className="text-muted-foreground tabular-nums">
                {fmtTime(stage.tMs)} / {stage.durS !== null ? fmtTime(stage.durS * 1000) : '…'}
              </span>
            </div>
          )}
        </Card>
      )}

      {stage.kind === 'analyzing' && (
        <Card className="mx-auto my-10 flex max-w-[640px] flex-col gap-3.5">
          <CardTitle>Analyzing segments…</CardTitle>
          <p className="text-muted-foreground">
            Analyzing segment {stage.index + 1} of {stage.total}…
          </p>
        </Card>
      )}

      {stage.kind === 'error' && (
        <div className="rounded-xl border border-danger/45 bg-danger-surface p-3.5 text-sm">
          <strong>
            {stage.backTo === 'subject' ? 'Could not analyze this video. ' : 'Analysis failed: '}
          </strong>
          {stage.message}
          <div className="mt-2.5">
            <Button
              variant="ghost"
              onClick={() =>
                stage.backTo === 'subject' ? backToSubject() : setStage({ kind: 'review' })
              }
            >
              {stage.backTo === 'subject' ? 'Back to subject' : 'Back to review'}
            </Button>
          </div>
        </div>
      )}

      {stage.kind === 'review' && (
        <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-4 max-[900px]:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-2.5">
            <div className="overflow-hidden rounded-xl border bg-black">
              <video
                ref={playerRef}
                className="block max-h-[60vh] w-full"
                controls
                playsInline
                muted
                src={playerUrl}
              />
            </div>
            <TimelineView
              durationMs={durationMs}
              framesRef={framesRef}
              segments={segments}
              selected={selected}
              playerRef={playerRef}
              onSeek={(ms) => {
                if (playerRef.current) playerRef.current.currentTime = ms / 1000
              }}
              onSelect={setSelected}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <Card>
              <CardTitle>Detection</CardTitle>
              <CheckboxRow
                checked={swapped}
                onChange={() => setConfirmSwap(true)}
                className="mt-2"
              >
                Hands look swapped (mirrored video)
              </CheckboxRow>
              <CheckboxRow checked={keepVideo} onChange={setKeepVideo} className="mt-1.5">
                Save source video with results
              </CheckboxRow>
              <Button
                variant="ghost"
                className="mt-2.5"
                onClick={() => {
                  const at = (playerRef.current?.currentTime ?? 0) * 1000
                  const near = segments[selected] ?? segments[segments.length - 1]
                  editSegments((segs) => [
                    ...segs,
                    {
                      startMs: at,
                      endMs: Math.min(at + 10_000, durationMs),
                      hand: near?.hand ?? 'right',
                      testId: near?.testId ?? 'finger_tap',
                      confidence: 1, // operator-defined
                    },
                  ])
                  setSelected(segments.length) // appended before sort; close enough, matches vanilla intent
                }}
              >
                <Plus /> Add segment at playhead
              </Button>
            </Card>

            <Card>
              {sel ? (
                <>
                  <CardTitle>
                    Segment {selected + 1} of {segments.length}
                  </CardTitle>
                  {sel.confidence < SEG_CONFIDENCE_WARN && (
                    <p className="mt-1 text-[12.5px] text-warn">
                      ⚠ Low auto-detection confidence ({(sel.confidence * 100).toFixed(0)}%) —
                      please double-check.
                    </p>
                  )}
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-2.5">
                    <Field label="Hand">
                      <Select
                        value={sel.hand}
                        onChange={(e) =>
                          editSegments((segs) => {
                            segs[selected]!.hand = e.target.value as Hand
                            return segs
                          })
                        }
                      >
                        <option value="left">Left hand</option>
                        <option value="right">Right hand</option>
                      </Select>
                    </Field>
                    <Field label="Movement">
                      <Select
                        value={sel.testId}
                        onChange={(e) =>
                          editSegments((segs) => {
                            segs[selected]!.testId = e.target.value as EditableSegment['testId']
                            return segs
                          })
                        }
                      >
                        <option value="finger_tap">Finger Tapping</option>
                        <option value="fist_open_close">Fist Open–Close</option>
                      </Select>
                    </Field>
                  </div>
                  <BoundRow
                    label="Start (s)"
                    value={sel.startMs}
                    durationMs={durationMs}
                    playerRef={playerRef}
                    onSet={(ms) =>
                      editSegments((segs) => {
                        segs[selected]!.startMs = ms
                        return segs
                      })
                    }
                  />
                  <BoundRow
                    label="End (s)"
                    value={sel.endMs}
                    durationMs={durationMs}
                    playerRef={playerRef}
                    onSet={(ms) =>
                      editSegments((segs) => {
                        segs[selected]!.endMs = ms
                        return segs
                      })
                    }
                  />
                  {segmentValid(sel) && (
                    <div className="mt-2 text-[13px] text-danger">{segmentValid(sel)}</div>
                  )}
                  {!segmentValid(sel) && sel.endMs - sel.startMs < SEG_MIN_SEGMENT_MS && (
                    <div className="mt-1.5 text-[12.5px] text-warn">
                      Shorter than {SEG_MIN_SEGMENT_MS / 1000} s — metrics will be unreliable.
                    </div>
                  )}
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="ghost-danger"
                      onClick={() => {
                        editSegments((segs) => segs.filter((_, i) => i !== selected))
                        setSelected(-1)
                      }}
                    >
                      <Trash2 /> Delete segment
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <CardTitle>Segment</CardTitle>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Click a block on the timeline to edit its hand, movement, or bounds.
                  </p>
                </>
              )}
            </Card>

            <Card>
              <Button
                variant="primary"
                className="w-full"
                disabled={segments.length === 0 || invalid > 0}
                onClick={() => void analyze()}
              >
                {segments.length === 0
                  ? 'No segments to analyze'
                  : `Analyze ${segments.length} segment${segments.length === 1 ? '' : 's'}`}
              </Button>
              {invalid > 0 && (
                <div className="mt-2 text-[13px] text-danger">
                  {invalid} segment(s) have invalid bounds
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={stage.kind === 'confirmLong'}
        onOpenChange={(open) => {
          if (!open && stage.kind === 'confirmLong') backToSubject()
        }}
        title="Long video"
        description={
          stage.kind === 'confirmLong'
            ? `This video is ${(stage.durS / 60).toFixed(1)} minutes long — processing takes roughly as long as the video. Continue?`
            : ''
        }
        confirmLabel="Process video"
        onConfirm={() => {
          if (stage.kind === 'confirmLong') void process(stage.durS)
        }}
        onCancel={() => backToSubject()}
      />
      <ConfirmDialog
        open={confirmSwap}
        onOpenChange={setConfirmSwap}
        title="Flip handedness and re-detect?"
        description="Flip left/right for every frame and re-run auto-detection? Manual edits are discarded."
        confirmLabel="Flip and re-detect"
        onConfirm={() => {
          setSwapped((v) => !v)
          framesRef.current = swapFramesHandedness(framesRef.current)
          setSegments(detectSegments(framesRef.current))
          setSelected(-1)
        }}
      />
      <ConfirmDialog
        open={confirmBack}
        onOpenChange={setConfirmBack}
        title="Discard this video analysis?"
        description="Detected segments and edits are not saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => backToSubject()}
      />
    </div>
  )
}

function BoundRow({
  label,
  value,
  durationMs,
  playerRef,
  onSet,
}: {
  label: string
  value: number
  durationMs: number
  playerRef: RefObject<HTMLVideoElement | null>
  onSet(ms: number): void
}) {
  const commit = (raw: string) => {
    const v = Number(raw)
    if (Number.isFinite(v)) onSet(v * 1000)
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="w-14 shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <Input
        key={value} // remount when the bound changes externally (playhead set)
        type="number"
        step={0.1}
        min={0}
        max={Number((durationMs / 1000).toFixed(1))}
        defaultValue={(value / 1000).toFixed(1)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
        className="w-24 flex-none"
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSet((playerRef.current?.currentTime ?? 0) * 1000)}
      >
        ⌖ playhead
      </Button>
    </div>
  )
}

/** Imperative canvas timeline wrapped for React; reads live state via refs. */
function TimelineView({
  durationMs,
  framesRef,
  segments,
  selected,
  playerRef,
  onSeek,
  onSelect,
}: {
  durationMs: number
  framesRef: RefObject<LandmarkFrame[]>
  segments: EditableSegment[]
  selected: number
  playerRef: RefObject<HTMLVideoElement | null>
  onSeek(ms: number): void
  onSelect(i: number): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const tlRef = useRef<SegmentTimeline | null>(null)
  const { resolved } = useTheme()
  const segRef = useRef(segments)
  segRef.current = segments
  const selRef = useRef(selected)
  selRef.current = selected
  const seekRef = useRef(onSeek)
  seekRef.current = onSeek
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  useEffect(() => {
    const frames = framesRef.current
    const coverageStep = Math.max(1, Math.floor(frames.length / 2000))
    const coverage = frames
      .filter((_, i) => i % coverageStep === 0)
      .map((f) => ({ t: f.t, hand: f.handedness }))
    const tl = createSegmentTimeline({
      durationMs,
      coverage,
      getSegments: () => segRef.current,
      getSelected: () => selRef.current,
      getPlayheadMs: () => (playerRef.current?.currentTime ?? 0) * 1000,
      onSeek: (ms) => seekRef.current(ms),
      onSelect: (i) => selectRef.current(i),
    })
    host.current!.appendChild(tl.el)
    tlRef.current = tl
    return () => {
      tl.destroy()
      tl.el.remove()
      tlRef.current = null
    }
  }, [durationMs, framesRef, playerRef, resolved])

  useEffect(() => {
    tlRef.current?.refresh()
  }, [segments, selected])

  return <div ref={host} />
}
