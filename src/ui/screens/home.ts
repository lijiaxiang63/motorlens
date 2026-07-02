// Home: live preview with skeleton overlay, source/detection status,
// test selection, and session-JSON import (drag-drop or file picker).

import { TEST_DEFS, testDefById } from '../../protocol/definitions'
import { createReplaySource } from '../../replay/replaySource'
import { parseSessionJson } from '../../report/export'
import type { Hand, LandmarkFrame, SourceStatus } from '../../types'
import type { AppContext, ScreenInstance } from '../app'
import { h, statusChip } from '../components'
import { createPreviewPanel } from '../preview'

export function createHomeScreen(ctx: AppContext): ScreenInstance {
  const source = ctx.source
  let hand: Hand = 'right'
  let lastFrame: LandmarkFrame | null = null
  const recvTimes: number[] = []

  // --- preview panel ---
  const preview = createPreviewPanel(source)
  const previewPanel = preview.el
  previewPanel.append(
    h('div', { class: 'drop-hint' }, 'Drop a MotorLens session .json here to replay it'),
  )

  const errorBox = h('div', { class: 'error-box', style: 'display:none' })

  // --- status chips ---
  const chipRow = h('div', { class: 'chip-row' })
  let statusState: SourceStatus = { state: 'init' }

  function renderChips() {
    const fps = recvTimes.length >= 2 ? (recvTimes.length - 1) / ((recvTimes[recvTimes.length - 1]! - recvTimes[0]!) / 1000) : 0
    const sourceLabel =
      source.kind === 'camera'
        ? statusState.state === 'ready'
          ? 'camera ready'
          : statusState.state === 'error'
            ? 'camera error'
            : 'loading model…'
        : `${source.kind} source`
    chipRow.replaceChildren(
      statusChip(
        sourceLabel,
        statusState.state === 'ready' ? 'ok' : statusState.state === 'error' ? 'err' : 'idle',
      ),
      statusChip(
        lastFrame?.handedness ? `${lastFrame.handedness} hand detected` : 'no hand detected',
        lastFrame?.handedness ? 'ok' : 'idle',
      ),
      statusChip(`${fps.toFixed(0)} fps`, fps >= 15 ? 'ok' : fps > 0 ? 'warn' : 'idle'),
    )
  }

  // --- test cards ---
  const cards = h('div', { class: 'card-list' })

  function renderCards() {
    const handToggle = h(
      'div',
      { class: 'hand-toggle', role: 'group', 'aria-label': 'Hand selection' },
      ...(['left', 'right'] as Hand[]).map((hd) =>
        h(
          'button',
          {
            class: `toggle-btn${hand === hd ? ' active' : ''}`,
            onclick: () => {
              hand = hd
              renderCards()
            },
          },
          hd === 'left' ? 'Left hand' : 'Right hand',
        ),
      ),
    )
    cards.replaceChildren(
      h(
        'div',
        { class: 'test-card subject-entry' },
        h('h3', {}, 'Subject session'),
        h(
          'p',
          { class: 'muted' },
          'Register subjects, run the test battery for each, save videos, and batch-export all results.',
        ),
        h(
          'div',
          { class: 'card-footer' },
          h('span', { class: 'muted small' }, 'batch workflow'),
          h(
            'button',
            { class: 'btn primary', onclick: () => ctx.navigate({ name: 'subjects' }) },
            'Open subjects',
          ),
        ),
      ),
      handToggle,
      ...TEST_DEFS.map((def) =>
        h(
          'div',
          { class: 'test-card' },
          h('h3', {}, def.title),
          h('p', { class: 'muted' }, def.description),
          h(
            'div',
            { class: 'card-footer' },
            h('span', { class: 'muted small' }, `${def.durationMs / 1000} s · ${hand} hand`),
            h(
              'button',
              { class: 'btn primary', onclick: () => ctx.navigate({ name: 'record', def, hand }) },
              'Start test',
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'test-card' },
        h('h3', {}, 'Joint Monitor'),
        h(
          'p',
          { class: 'muted' },
          'Live flexion angle, range of motion, and angular velocity for all 15 finger joints. Untimed.',
        ),
        h(
          'div',
          { class: 'card-footer' },
          h('span', { class: 'muted small' }, 'live · either hand'),
          h(
            'button',
            { class: 'btn primary', onclick: () => ctx.navigate({ name: 'monitor' }) },
            'Open monitor',
          ),
        ),
      ),
      h(
        'div',
        { class: 'import-row' },
        h(
          'button',
          { class: 'btn ghost', onclick: () => fileInput.click() },
          'Import session JSON…',
        ),
      ),
    )
  }

  // --- import ---
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' })
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0]
    if (f) void importFile(f)
  })

  async function importFile(file: File) {
    try {
      const report = parseSessionJson(await file.text())
      const def = testDefById(report.test)
      if (def) {
        // Recompute metrics from the raw frames — deterministic, so an
        // exported session reproduces its results exactly.
        ctx.navigate({
          name: 'results',
          result: {
            def,
            hand: report.hand,
            analysis: def.compute(report.raw.frames),
            frames: report.raw.frames,
            startedAt: report.startedAt,
          },
        })
        return
      }
      // Joint-monitor sessions replay as a live source instead.
      ctx.replaceSource(createReplaySource(report.raw.frames, { kind: 'replay', loop: true }))
    } catch (err) {
      errorBox.style.display = ''
      errorBox.replaceChildren(
        h('strong', {}, 'Could not import session: '),
        String(err instanceof Error ? err.message : err),
      )
    }
  }

  previewPanel.addEventListener('dragover', (e) => {
    e.preventDefault()
    previewPanel.classList.add('dragging')
  })
  previewPanel.addEventListener('dragleave', () => previewPanel.classList.remove('dragging'))
  previewPanel.addEventListener('drop', (e) => {
    e.preventDefault()
    previewPanel.classList.remove('dragging')
    const f = e.dataTransfer?.files?.[0]
    if (f) void importFile(f)
  })

  // --- error rendering for camera failures ---
  function renderError() {
    if (statusState.state !== 'error') {
      errorBox.style.display = 'none'
      return
    }
    errorBox.style.display = ''
    errorBox.replaceChildren(
      h('strong', {}, 'Camera unavailable. '),
      h('span', {}, statusState.message ?? 'Unknown error'),
      h(
        'div',
        { class: 'error-actions' },
        h('button', { class: 'btn ghost', onclick: () => location.reload() }, 'Retry'),
        h(
          'a',
          { class: 'btn ghost', href: '?source=synthetic&preset=tap-2hz' },
          'Use synthetic demo mode',
        ),
      ),
    )
  }

  const unsubFrames = source.subscribe((f) => {
    lastFrame = f
    preview.setFrame(f)
    recvTimes.push(performance.now())
    while (recvTimes.length > 0 && recvTimes[0]! < performance.now() - 2000) recvTimes.shift()
  })
  const unsubStatus = source.onStatus((s) => {
    statusState = s
    renderChips()
    renderError()
  })
  const chipTimer = setInterval(renderChips, 500)

  renderChips()
  renderCards()

  const el = h(
    'div',
    { class: 'screen home-screen' },
    h(
      'header',
      { class: 'app-header' },
      h('div', {}, h('h1', { class: 'brand' }, 'MotorLens'), h('p', { class: 'tagline' }, 'Camera-based hand motor function assessment')),
      chipRow,
    ),
    h('div', { class: 'home-grid' }, h('div', {}, previewPanel, errorBox), cards),
    h(
      'p',
      { class: 'disclaimer' },
      'MotorLens is an assessment aid, not a diagnostic device. All processing happens on this device; no video or data leaves your computer.',
    ),
    fileInput,
  )

  return {
    el,
    destroy() {
      preview.destroy()
      clearInterval(chipTimer)
      unsubFrames()
      unsubStatus()
    },
  }
}
