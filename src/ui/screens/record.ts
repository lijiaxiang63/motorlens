// Record screen: live skeleton preview + positioning gate → countdown →
// timed recording with a live signal chart and running event count → hands
// off to the results screen.

import { createTestRecorder, type TestRecorder } from '../../capture/videoRecorder'
import { LIVE_CHART_WINDOW_MS, LIVE_COUNT_THROTTLE_MS } from '../../config'
import { ScaleSmoother, worldHandScale } from '../../metrics/kinematics'
import type { TestDefinition } from '../../protocol/definitions'
import { TestSession, type Phase, type PositioningIssue } from '../../protocol/testSession'
import { LiveEma } from '../../signal/filters'
import type { Hand } from '../../types'
import type { AppContext, ScreenInstance, SubjectTestContext } from '../app'
import { h } from '../components'
import { createStreamChart } from '../liveChart'
import { createPreviewPanel } from '../preview'

const ISSUE_TEXT: Record<PositioningIssue, string> = {
  warming_up: 'Looking for your hand…',
  no_hand: 'Show your hand to the camera',
  wrong_hand: '', // composed dynamically with the detected hand
  too_far: 'Move your hand closer to the camera',
  too_close: 'Move your hand a little further away',
  low_fps: 'Frame rate is low — close other apps or improve lighting',
}

export function createRecordScreen(
  ctx: AppContext,
  def: TestDefinition,
  hand: Hand,
  subjectCtx?: SubjectTestContext,
): ScreenInstance {
  const session = new TestSession(def.durationMs, hand)
  const ema = new LiveEma(def.fcHz)
  const scaler = new ScaleSmoother()
  let startedAt = ''
  let started = false
  let finished = false
  let lastCountT = -Infinity
  let lastDetectedHand: Hand | null = null

  // Camera video capture — subject mode only; null on synthetic/replay
  // sources, unsupported browsers, or when the operator turned it off.
  const wantVideo = subjectCtx?.saveVideo === true && ctx.source.kind === 'camera'
  let recorder: TestRecorder | null = null

  const preview = createPreviewPanel(ctx.source, { highlight: def.highlightLandmarks })
  const stage = h('div', { class: 'stage' })
  const countEl = h('div', { class: 'live-count', style: 'visibility:hidden' }, '0')
  const chartEl = h('div', { class: 'chart-panel' })
  const chart = createStreamChart(chartEl, {
    yRange: def.liveYRange,
    windowMs: LIVE_CHART_WINDOW_MS,
  })

  function issueText(i: PositioningIssue): string {
    if (i !== 'wrong_hand') return ISSUE_TEXT[i]
    const seen = lastDetectedHand ?? 'other'
    return `Detected the ${seen} hand — this test is set for the ${hand} hand. Switch hands, or go Home to change the setting.`
  }

  function renderPhase(p: Phase) {
    switch (p.kind) {
      case 'positioning':
        stage.replaceChildren(
          h('p', { class: 'instructions' }, def.instructions),
          h(
            'div',
            { class: 'issues' },
            ...p.issues.map((i) => h('div', { class: 'issue' }, issueText(i))),
          ),
        )
        break
      case 'countdown':
        stage.replaceChildren(
          h('div', { class: 'countdown' }, String(Math.ceil(p.remainingMs / 1000))),
          h('p', { class: 'muted' }, 'Get ready…'),
        )
        break
      case 'recording': {
        if (!started) {
          started = true
          startedAt = new Date().toISOString()
          countEl.style.visibility = 'visible'
          if (wantVideo) {
            // Created here (not at mount) so the camera video element is
            // guaranteed to exist and its stream to be live.
            recorder = createTestRecorder(ctx.source.video)
            recorder?.start()
          }
        }
        const pct = Math.min((p.elapsedMs / def.durationMs) * 100, 100)
        const secondsLeft = Math.max((def.durationMs - p.elapsedMs) / 1000, 0)
        stage.replaceChildren(
          h('div', { class: 'progress-row' },
            h('div', { class: 'progress-track' },
              h('div', { class: 'progress-fill', style: `width:${pct}%` }),
            ),
            h('span', { class: 'progress-time' }, `${secondsLeft.toFixed(1)} s`),
          ),
          h('p', { class: 'muted recording-hint' }, 'Recording — keep going as fast and big as you can'),
        )
        const lastT = p.frames[p.frames.length - 1]!.t
        if (lastT - lastCountT >= LIVE_COUNT_THROTTLE_MS) {
          lastCountT = lastT
          countEl.textContent = String(def.compute(p.frames).events.length)
        }
        break
      }
      case 'done': {
        if (finished) break
        finished = true
        const frames = p.frames
        // Defer navigation out of the subscriber callback; recorder.stop()
        // resolves quickly (or times out) and never blocks the results.
        const rec = recorder
        recorder = null
        void (async () => {
          // Defer navigation out of the subscriber callback (also when there
          // is no recorder and rec.stop() contributes no await).
          await Promise.resolve()
          const video = rec ? await rec.stop() : null
          ctx.navigate({
            name: 'results',
            result: {
              def,
              hand,
              analysis: def.compute(frames),
              frames,
              startedAt,
              ...(subjectCtx
                ? {
                    subject: subjectCtx.subject,
                    source: { kind: 'live' as const },
                    capturedVideo: video,
                    videoCaptureFailed: wantVideo && !video,
                  }
                : {}),
            },
          })
        })()
        break
      }
      case 'cancelled':
        break
    }
  }

  const unsubFrames = ctx.source.subscribe((f) => {
    session.onFrame(f)
    preview.setFrame(f)
    if (f.handedness) lastDetectedHand = f.handedness
    if (f.world) {
      const scale = scaler.push(worldHandScale(f.world))
      chart.push(f.t, ema.push(f.t, def.rawSignal(f.world) / scale))
    }
  })
  const unsubPhase = session.subscribe(renderPhase)

  // Replayed/synthetic sources restart so the recording window always covers
  // a fresh pass of the pattern.
  if (ctx.source.kind !== 'camera') ctx.source.restart()

  const el = h(
    'div',
    { class: 'screen record-screen' },
    h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        {},
        h('h2', {}, def.title),
        h(
          'p',
          { class: 'muted' },
          `${hand === 'left' ? 'Left' : 'Right'} hand · ${def.durationMs / 1000} s` +
            (subjectCtx ? ` · ${subjectCtx.subject.code}` : ''),
        ),
      ),
      h(
        'button',
        {
          class: 'btn ghost',
          onclick: () => {
            session.cancel()
            if (subjectCtx) {
              ctx.navigate({ name: 'subject', subjectId: subjectCtx.subject.id })
            } else {
              ctx.navigate({ name: 'home' })
            }
          },
        },
        'Cancel',
      ),
    ),
    h(
      'div',
      { class: 'record-grid' },
      preview.el,
      h(
        'div',
        { class: 'record-side' },
        stage,
        h('div', { class: 'count-panel' }, countEl, h('div', { class: 'muted small' }, def.eventNoun[1])),
      ),
    ),
    chartEl,
  )

  return {
    el,
    destroy() {
      recorder?.cancel() // discard partial capture on cancel/unmount
      unsubFrames()
      unsubPhase()
      preview.destroy()
      chart.destroy()
    },
  }
}
