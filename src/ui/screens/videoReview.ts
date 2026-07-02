// Video-upload analysis: run MediaPipe over the file (with progress), show
// auto-detected segments on a timeline for correction, then analyze each
// confirmed segment with the standard pipeline and save the results under
// the subject. Works without any FrameSource — the uploaded file is the
// only input.

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
import type { AppContext, ScreenInstance } from '../app'
import { h } from '../components'
import { createSegmentTimeline, type EditableSegment, type SegmentTimeline } from '../segmentTimeline'

function fmtTime(ms: number): string {
  const s = Math.max(ms, 0) / 1000
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

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

export function createVideoReviewScreen(
  ctx: AppContext,
  subject: Subject,
  file: File,
): ScreenInstance {
  let destroyed = false
  const abort = new AbortController()
  const playerUrl = URL.createObjectURL(file)

  let frames: LandmarkFrame[] = []
  let durationMs = 0
  let segments: EditableSegment[] = []
  let selected = -1
  let swapped = false
  let keepVideo = true
  let timeline: SegmentTimeline | null = null

  const body = h('div', {})
  const el = h('div', { class: 'screen video-review-screen' }, body)

  const player = h('video', { class: 'review-video', controls: true, playsinline: true }) as HTMLVideoElement
  player.muted = true
  player.src = playerUrl

  function backToSubject(notice?: string) {
    ctx.navigate({ name: 'subject', subjectId: subject.id, ...(notice ? { notice } : {}) })
  }

  // ---------------------------------------------------------------- phases

  function renderProcessing(progressEl: HTMLElement) {
    body.replaceChildren(
      h(
        'header',
        { class: 'app-header' },
        h(
          'div',
          {},
          h('h2', {}, `Video analysis — ${subject.code}`),
          h('p', { class: 'muted' }, file.name),
        ),
        h('button', { class: 'btn ghost', onclick: () => backToSubject() }, 'Cancel'),
      ),
      h('div', { class: 'test-card processing-card' }, h('h3', {}, 'Detecting hand movements…'), progressEl),
    )
  }

  async function start() {
    const durS = await probeDurationS(file)
    if (destroyed) return
    if (durS !== null && durS > VIDEO_WARN_DURATION_S) {
      const mins = (durS / 60).toFixed(1)
      if (!confirm(`This video is ${mins} minutes long — processing takes roughly as long as the video. Continue?`)) {
        backToSubject()
        return
      }
    }

    const bar = h('div', { class: 'progress-fill', style: 'width:0%' })
    const label = h('span', { class: 'progress-time' }, '0:00')
    const progressEl = h(
      'div',
      { class: 'progress-row' },
      h('div', { class: 'progress-track' }, bar),
      label,
    )
    renderProcessing(progressEl)

    try {
      // Lazy import keeps MediaPipe out of the main bundle (same rule as the
      // camera source in main.ts) — synthetic sessions never load it.
      const { processVideoFile } = await import('../../tracking/videoFile')
      const processed = await processVideoFile(
        file,
        (fraction, tMs) => {
          bar.style.width = `${(fraction * 100).toFixed(1)}%`
          label.textContent = `${fmtTime(tMs)} / ${durS !== null ? fmtTime(durS * 1000) : '…'}`
        },
        abort.signal,
      )
      if (destroyed) return
      frames = processed.frames
      durationMs = processed.durationMs
      segments = detectSegments(frames)
      renderReview()
    } catch (err) {
      if (destroyed || (err instanceof DOMException && err.name === 'AbortError')) return
      body.replaceChildren(
        h(
          'div',
          { class: 'error-box' },
          h('strong', {}, 'Could not analyze this video. '),
          String(err instanceof Error ? err.message : err),
          h(
            'div',
            { class: 'error-actions' },
            h('button', { class: 'btn ghost', onclick: () => backToSubject() }, 'Back to subject'),
          ),
        ),
      )
    }
  }

  // ---------------------------------------------------------------- review

  function segmentValid(s: EditableSegment): string | null {
    if (!(s.startMs < s.endMs)) return 'start must be before end'
    if (s.startMs < 0 || s.endMs > durationMs) return 'outside the video'
    return null
  }

  function renderEditor(editorSlot: HTMLElement) {
    const s = segments[selected]
    if (!s) {
      editorSlot.replaceChildren(
        h('h3', {}, 'Segment'),
        h('p', { class: 'muted small' }, 'Click a block on the timeline to edit its hand, movement, or bounds.'),
      )
      return
    }
    const err = segmentValid(s)
    const short = !err && s.endMs - s.startMs < SEG_MIN_SEGMENT_MS

    const handSel = h(
      'select',
      {},
      ...(['left', 'right'] as const).map((hd) =>
        h('option', { value: hd, selected: s.hand === hd }, hd === 'left' ? 'Left hand' : 'Right hand'),
      ),
    )
    handSel.addEventListener('change', () => {
      s.hand = handSel.value as Hand
      onSegmentsEdited()
    })
    const testSel = h(
      'select',
      {},
      h('option', { value: 'finger_tap', selected: s.testId === 'finger_tap' }, 'Finger Tapping'),
      h('option', { value: 'fist_open_close', selected: s.testId === 'fist_open_close' }, 'Fist Open–Close'),
    )
    testSel.addEventListener('change', () => {
      s.testId = testSel.value as EditableSegment['testId']
      onSegmentsEdited()
    })

    const boundRow = (label: string, get: () => number, set: (ms: number) => void) => {
      const input = h('input', { type: 'number', step: 0.1, min: 0, max: (durationMs / 1000).toFixed(1) }) as HTMLInputElement
      input.value = (get() / 1000).toFixed(1)
      input.addEventListener('change', () => {
        const v = Number(input.value)
        if (Number.isFinite(v)) set(v * 1000)
        onSegmentsEdited()
      })
      return h(
        'div',
        { class: 'bound-row' },
        h('span', { class: 'muted small bound-label' }, label),
        input,
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              set(player.currentTime * 1000)
              onSegmentsEdited()
            },
          },
          '⌖ playhead',
        ),
      )
    }

    editorSlot.replaceChildren(
      h(
        'div',
        {},
        h('h3', {}, `Segment ${selected + 1} of ${segments.length}`),
        s.confidence < SEG_CONFIDENCE_WARN
          ? h('p', { class: 'small', style: 'color: var(--warn)' }, `⚠ Low auto-detection confidence (${(s.confidence * 100).toFixed(0)}%) — please double-check.`)
          : null,
        h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', {}, 'Hand'), handSel), h('label', { class: 'field' }, h('span', {}, 'Movement'), testSel)),
        boundRow('Start (s)', () => s.startMs, (v) => (s.startMs = v)),
        boundRow('End (s)', () => s.endMs, (v) => (s.endMs = v)),
        err ? h('div', { class: 'field-error' }, err) : null,
        short ? h('div', { class: 'small', style: 'color: var(--warn); margin-top:6px' }, `Shorter than ${SEG_MIN_SEGMENT_MS / 1000} s — metrics will be unreliable.`) : null,
        h(
          'div',
          { class: 'form-actions' },
          h(
            'button',
            {
              class: 'btn ghost danger',
              onclick: () => {
                segments.splice(selected, 1)
                selected = -1
                onSegmentsEdited()
              },
            },
            'Delete segment',
          ),
        ),
      ),
    )
  }

  let editorSlotRef: HTMLElement | null = null
  let analyzeBtnRef: HTMLButtonElement | null = null
  let statusLineRef: HTMLElement | null = null

  function onSegmentsEdited() {
    segments.sort((a, b) => a.startMs - b.startMs)
    if (editorSlotRef) renderEditor(editorSlotRef)
    timeline?.refresh()
    updateAnalyzeState()
  }

  function updateAnalyzeState() {
    if (!analyzeBtnRef || !statusLineRef) return
    const invalid = segments.filter((s) => segmentValid(s) !== null).length
    analyzeBtnRef.disabled = segments.length === 0 || invalid > 0
    analyzeBtnRef.textContent =
      segments.length === 0 ? 'No segments to analyze' : `Analyze ${segments.length} segment${segments.length === 1 ? '' : 's'}`
    statusLineRef.textContent = invalid > 0 ? `${invalid} segment(s) have invalid bounds` : ''
  }

  function renderReview() {
    const coverageStep = Math.max(1, Math.floor(frames.length / 2000))
    const coverage = frames
      .filter((_, i) => i % coverageStep === 0)
      .map((f) => ({ t: f.t, hand: f.handedness }))

    timeline?.destroy()
    timeline = createSegmentTimeline({
      durationMs,
      coverage,
      getSegments: () => segments,
      getSelected: () => selected,
      getPlayheadMs: () => player.currentTime * 1000,
      onSeek: (ms) => {
        player.currentTime = ms / 1000
      },
      onSelect: (i) => {
        selected = i
        if (editorSlotRef) renderEditor(editorSlotRef)
        timeline?.refresh()
      },
    })

    const swapCb = h('input', { type: 'checkbox' }) as HTMLInputElement
    swapCb.checked = swapped
    swapCb.addEventListener('change', () => {
      if (!confirm('Flip left/right for every frame and re-run auto-detection? Manual edits are discarded.')) {
        swapCb.checked = swapped
        return
      }
      swapped = swapCb.checked
      frames = swapFramesHandedness(frames)
      segments = detectSegments(frames)
      selected = -1
      onSegmentsEdited()
    })

    const keepCb = h('input', { type: 'checkbox' }) as HTMLInputElement
    keepCb.checked = keepVideo
    keepCb.addEventListener('change', () => {
      keepVideo = keepCb.checked
    })

    const editorSlot = h('div', { class: 'test-card' })
    editorSlotRef = editorSlot
    renderEditor(editorSlot)

    const analyzeBtn = h('button', { class: 'btn primary' }, '') as HTMLButtonElement
    analyzeBtn.addEventListener('click', () => void analyze())
    analyzeBtnRef = analyzeBtn
    const statusLine = h('div', { class: 'field-error' })
    statusLineRef = statusLine

    body.replaceChildren(
      h(
        'header',
        { class: 'app-header' },
        h(
          'div',
          {},
          h('h2', {}, `Video analysis — ${subject.code}`),
          h(
            'p',
            { class: 'muted' },
            `${file.name} · ${fmtTime(durationMs)} · ${segments.length} segment${segments.length === 1 ? '' : 's'} auto-detected`,
          ),
        ),
        h(
          'button',
          {
            class: 'btn ghost',
            onclick: () => {
              if (segments.length === 0 || confirm('Discard this video analysis?')) backToSubject()
            },
          },
          '← Subject',
        ),
      ),
      h(
        'div',
        { class: 'review-grid' },
        h('div', { class: 'review-left' }, h('div', { class: 'video-panel' }, player), timeline.el),
        h(
          'div',
          { class: 'record-side' },
          h(
            'div',
            { class: 'test-card' },
            h('h3', {}, 'Detection'),
            h('label', { class: 'save-video-toggle' }, swapCb, h('span', { class: 'small' }, 'Hands look swapped (mirrored video)')),
            h('label', { class: 'save-video-toggle' }, keepCb, h('span', { class: 'small' }, 'Save source video with results')),
            h(
              'button',
              {
                class: 'btn ghost',
                style: 'margin-top:10px',
                onclick: () => {
                  const at = player.currentTime * 1000
                  const near = segments[selected] ?? segments[segments.length - 1]
                  segments.push({
                    startMs: at,
                    endMs: Math.min(at + 10_000, durationMs),
                    hand: near?.hand ?? 'right',
                    testId: near?.testId ?? 'finger_tap',
                    confidence: 1, // operator-defined
                  })
                  selected = segments.length - 1
                  onSegmentsEdited()
                },
              },
              '+ Add segment at playhead',
            ),
          ),
          editorSlot,
          h('div', { class: 'test-card' }, analyzeBtn, statusLine),
        ),
      ),
    )
    updateAnalyzeState()
  }

  // --------------------------------------------------------------- analyze

  async function analyze() {
    if (segments.length === 0) return
    const ordered = segments.slice().sort((a, b) => a.startMs - b.startMs)
    const progress = h('p', { class: 'muted' }, '')
    body.replaceChildren(
      h('div', { class: 'test-card processing-card' }, h('h3', {}, 'Analyzing segments…'), progress),
    )

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
        progress.textContent = `Analyzing segment ${i + 1} of ${ordered.length}…`
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
        if (destroyed) return
      }
      backToSubject(
        `Added ${ordered.length} result${ordered.length === 1 ? '' : 's'} from ${file.name}`,
      )
    } catch (err) {
      if (destroyed) return
      body.replaceChildren(
        h(
          'div',
          { class: 'error-box' },
          h('strong', {}, 'Analysis failed: '),
          String(err instanceof Error ? err.message : err),
          h(
            'div',
            { class: 'error-actions' },
            h('button', { class: 'btn ghost', onclick: () => renderReview() }, 'Back to review'),
          ),
        ),
      )
    }
  }

  void start()

  return {
    el,
    destroy() {
      destroyed = true
      abort.abort()
      timeline?.destroy()
      player.pause()
      player.removeAttribute('src')
      URL.revokeObjectURL(playerUrl)
    },
  }
}
