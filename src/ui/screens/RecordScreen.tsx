// Record screen: live skeleton preview + positioning gate → countdown →
// timed recording with a live signal chart and running event count → hands
// off to the results screen.
//
// React integration rules (protecting real-hardware invariants):
//  - Frame data bypasses React: the source subscription feeds the session and
//    pushes EMA-filtered samples straight into the uPlot handle. Only the
//    small stage panel re-renders from phase changes, via useSyncExternalStore.
//  - MediaRecorder side-effects key off phase *transitions* tracked in refs
//    (`started`, `finished`), so StrictMode's double-invoked effects can never
//    double-start a recorder or navigate twice.
//  - The recorder is created at recording start (not mount) so the camera
//    video element is guaranteed to exist and its stream to be live.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createTestRecorder, type TestRecorder } from '../../capture/videoRecorder'
import { LIVE_CHART_WINDOW_MS, LIVE_COUNT_THROTTLE_MS } from '../../config'
import { JOINT_IDS, JointTracker } from '../../metrics/angles'
import { ScaleSmoother, worldHandScale } from '../../metrics/kinematics'
import type { TestDefinition } from '../../protocol/definitions'
import { TestSession, type Phase, type PositioningIssue } from '../../protocol/testSession'
import { LiveEma } from '../../signal/filters'
import type { Hand, JointSummaries } from '../../types'
import { StreamChart, type StreamChartHandle } from '../charts/charts'
import { Button } from '../components/ui/button'
import { JointTable } from '../components/JointTable'
import { PageHeader } from '../components/PageHeader'
import { fmt } from '../format'
import { useInterval } from '../hooks/useInterval'
import { useNav, type SubjectTestContext } from '../nav'
import { PreviewPanel } from '../PreviewPanel'
import { buildResultProps } from '../resultProps'

/** Live ROM chart plots the summed 15-joint flexion (°). */
const ROM_LIVE_Y_RANGE: readonly [number, number] = [0, 1000]

const ISSUE_TEXT: Record<PositioningIssue, string> = {
  warming_up: 'Looking for your hand…',
  no_hand: 'Show your hand to the camera',
  wrong_hand: '', // composed dynamically with the detected hand
  too_far: 'Move your hand closer to the camera',
  too_close: 'Move your hand a little further away',
  low_fps: 'Frame rate is low — close other apps or improve lighting',
}

export function RecordScreen({
  def,
  hand,
  subjectCtx,
}: {
  def: TestDefinition
  hand: Hand
  subjectCtx?: SubjectTestContext
}) {
  const { navigate, source } = useNav()

  // One session per screen mount; refs survive StrictMode's double effects.
  const sessionRef = useRef<TestSession | null>(null)
  sessionRef.current ??= new TestSession(def.durationMs, hand)
  const session = sessionRef.current

  const chartRef = useRef<StreamChartHandle>(null)
  const recorderRef = useRef<TestRecorder | null>(null)
  const startedRef = useRef(false)
  const finishedRef = useRef(false)
  const startedAtRef = useRef('')
  const lastCountTRef = useRef(-Infinity)
  const lastDetectedHandRef = useRef<Hand | null>(null)
  const [count, setCount] = useState<number | null>(null)

  // ROM family: live joint tracker feeding the table + total-flexion chart.
  // Display-only — the saved metrics come from def.compute over the recorded
  // frames; the tracker resets at recording start so its accumulators match
  // the measured window.
  const trackerRef = useRef<JointTracker | null>(null)
  if (def.family === 'rom') trackerRef.current ??= new JointTracker()
  const [romSummaries, setRomSummaries] = useState<JointSummaries | null>(null)
  useInterval(() => {
    if (trackerRef.current) setRomSummaries(trackerRef.current.summaries())
  }, 200)

  // Camera video capture — subject mode only; null on synthetic/replay
  // sources, unsupported browsers, or when the operator turned it off.
  const wantVideo = subjectCtx?.saveVideo === true && source.kind === 'camera'

  useEffect(() => {
    const ema = def.family === 'cycle' ? new LiveEma(def.fcHz) : null
    const scaler = new ScaleSmoother()

    const unsubFrames = source.subscribe((f) => {
      session.onFrame(f)
      if (f.handedness) lastDetectedHandRef.current = f.handedness
      if (!f.world) return
      if (def.family === 'cycle') {
        // 'hand' signals normalize by hand scale; 'degrees' signals plot raw
        // (wrapped) angle values — scale division would be meaningless there.
        const scale = scaler.push(worldHandScale(f.world))
        const raw = def.rawSignal(f.world)
        chartRef.current?.push(f.t, ema!.push(f.t, def.signalKind === 'hand' ? raw / scale : raw))
      } else {
        const tracker = trackerRef.current!
        tracker.push(f)
        // Total flexion = sum of the smoothed per-joint currents.
        let sum = 0
        for (const id of JOINT_IDS) {
          const s = tracker.series(id)
          if (s.v.length > 0) sum += s.v[s.v.length - 1]!
        }
        chartRef.current?.push(f.t, sum)
      }
    })

    const unsubPhase = session.subscribe((p: Phase) => {
      switch (p.kind) {
        case 'recording': {
          if (!startedRef.current) {
            startedRef.current = true
            startedAtRef.current = new Date().toISOString()
            if (def.family === 'cycle') setCount(0)
            // Align the live ROM accumulators with the measured window.
            trackerRef.current?.reset()
            if (wantVideo) {
              recorderRef.current = createTestRecorder(source.video)
              recorderRef.current?.start()
            }
          }
          if (def.family === 'cycle') {
            const lastT = p.frames[p.frames.length - 1]!.t
            if (lastT - lastCountTRef.current >= LIVE_COUNT_THROTTLE_MS) {
              lastCountTRef.current = lastT
              setCount(def.compute(p.frames).events.length)
            }
          }
          break
        }
        case 'done': {
          if (finishedRef.current) break
          finishedRef.current = true
          const frames = p.frames
          // Defer navigation out of the subscriber callback; recorder.stop()
          // resolves quickly (or times out) and never blocks the results.
          const rec = recorderRef.current
          recorderRef.current = null
          void (async () => {
            await Promise.resolve()
            const video = rec ? await rec.stop() : null
            navigate({
              name: 'results',
              result: buildResultProps(def, frames, {
                hand,
                startedAt: startedAtRef.current,
                ...(subjectCtx
                  ? {
                      subject: subjectCtx.subject,
                      source: { kind: 'live' as const },
                      capturedVideo: video,
                      videoCaptureFailed: wantVideo && !video,
                    }
                  : {}),
              }),
            })
          })()
          break
        }
        default:
          break
      }
    })

    // Replayed/synthetic sources restart so the recording window always
    // covers a fresh pass of the pattern.
    if (source.kind !== 'camera') source.restart()

    return () => {
      unsubFrames()
      unsubPhase()
      recorderRef.current?.cancel() // discard partial capture on cancel/unmount
      recorderRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, session, def, hand, wantVideo])

  function cancel() {
    session.cancel()
    if (subjectCtx) navigate({ name: 'subject', subjectId: subjectCtx.subject.id })
    else navigate({ name: 'home' })
  }

  const startedDateBit = subjectCtx ? ` · ${subjectCtx.subject.code}` : ''
  const liveTotalRom = romSummaries
    ? JOINT_IDS.reduce((s, id) => s + (romSummaries[id].romDeg ?? 0), 0)
    : null

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <PageHeader
        title={def.title}
        description={
          <>
            {hand === 'left' ? 'Left' : 'Right'} hand · {def.durationMs / 1000} s
            {startedDateBit}
          </>
        }
        actions={
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 items-stretch gap-4 min-w-0-children max-[900px]:grid-cols-1">
        <PreviewPanel highlight={def.highlightLandmarks} />
        <div className="flex min-w-0 flex-col gap-3">
          <StagePanel session={session} def={def} hand={hand} detectedRef={lastDetectedHandRef} />
          {def.family === 'cycle' ? (
            <div className="rounded-xl border bg-surface px-2.5 py-4 text-center">
              <div
                className="text-[64px] font-bold leading-none tabular-nums text-ok"
                style={{ visibility: count === null ? 'hidden' : undefined }}
              >
                {count ?? 0}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{def.eventNoun[1]}</div>
            </div>
          ) : (
            <div className="rounded-xl border bg-surface px-2.5 py-4 text-center">
              <div className="text-[64px] font-bold leading-none tabular-nums text-ok">
                {fmt(liveTotalRom, 0, '°')}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">total active ROM</div>
            </div>
          )}
        </div>
      </div>

      {def.family === 'rom' && romSummaries && (
        <JointTable summaries={romSummaries} className="mb-4" />
      )}

      <StreamChart
        ref={chartRef}
        yRange={def.family === 'cycle' ? def.liveYRange : ROM_LIVE_Y_RANGE}
        windowMs={LIVE_CHART_WINDOW_MS}
      />
    </div>
  )
}

/** The only part of the screen that re-renders from phase updates. */
function StagePanel({
  session,
  def,
  hand,
  detectedRef,
}: {
  session: TestSession
  def: TestDefinition
  hand: Hand
  detectedRef: React.RefObject<Hand | null>
}) {
  const subscribe = useCallback((cb: () => void) => session.subscribe(() => cb()), [session])
  const phase = useSyncExternalStore(subscribe, () => session.current)

  const issueText = (i: PositioningIssue): string => {
    if (i !== 'wrong_hand') return ISSUE_TEXT[i]
    const seen = detectedRef.current ?? 'other'
    return `Detected the ${seen} hand — this test is set for the ${hand} hand. Switch hands, or go back to change the setting.`
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border bg-surface p-4 text-center min-h-[140px]">
      {phase.kind === 'positioning' && (
        <>
          <p className="max-w-[560px] text-[15px]">{def.instructions}</p>
          <div className="flex flex-col gap-1">
            {phase.issues.map((i) => (
              <div key={i} className="text-sm text-warn">
                {issueText(i)}
              </div>
            ))}
          </div>
        </>
      )}
      {phase.kind === 'countdown' && (
        <>
          <div className="text-[96px] font-bold leading-none text-accent tabular-nums">
            {Math.ceil(phase.remainingMs / 1000)}
          </div>
          <p className="text-muted-foreground">Get ready…</p>
        </>
      )}
      {phase.kind === 'recording' && (
        <>
          <div className="flex w-[min(560px,90%)] items-center gap-3">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-accent transition-[width] duration-75 ease-linear"
                style={{ width: `${Math.min((phase.elapsedMs / def.durationMs) * 100, 100)}%` }}
              />
            </div>
            <span className="min-w-12 text-right text-muted-foreground tabular-nums">
              {(Math.max(def.durationMs - phase.elapsedMs, 0) / 1000).toFixed(1)} s
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Recording — keep going as fast and big as you can
          </p>
        </>
      )}
      {(phase.kind === 'done' || phase.kind === 'cancelled') && null}
    </div>
  )
}
