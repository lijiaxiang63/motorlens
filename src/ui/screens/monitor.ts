// Joint Monitor: live flexion angles for all 15 finger joints with ROM and
// peak angular velocity accumulators, plus a streaming chart for the
// selected joint. Untimed — runs until the user leaves.

import { JOINT_IDS, JointTracker } from '../../metrics/angles'
import { buildSessionReport, downloadReport } from '../../report/export'
import type { Hand, JointId, LandmarkFrame } from '../../types'
import type { AppContext, ScreenInstance } from '../app'
import { createStreamChart, type StreamChart } from '../liveChart'
import { fmt, h } from '../components'

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const
const JOINT_COLUMNS: Record<(typeof FINGERS)[number], readonly [JointId, JointId, JointId]> = {
  thumb: ['thumb_cmc', 'thumb_mcp', 'thumb_ip'],
  index: ['index_mcp', 'index_pip', 'index_dip'],
  middle: ['middle_mcp', 'middle_pip', 'middle_dip'],
  ring: ['ring_mcp', 'ring_pip', 'ring_dip'],
  pinky: ['pinky_mcp', 'pinky_pip', 'pinky_dip'],
}
const COLUMN_TITLES = ['MCP / CMC', 'PIP / MCP', 'DIP / IP']
const FRAME_BUFFER_MS = 30_000

export function createMonitorScreen(ctx: AppContext): ScreenInstance {
  const tracker = new JointTracker()
  const startedAt = new Date().toISOString()
  let selected: JointId = 'index_pip'
  let frames: LandmarkFrame[] = []
  let lastHand: Hand = 'right'
  let chart: StreamChart | null = null

  const chartEl = h('div', { class: 'chart-panel' })
  const chartTitle = h('h3', { class: 'section-title' }, chartLabel(selected))
  const detailEl = h('div', { class: 'joint-detail muted small' })

  function chartLabel(id: JointId): string {
    return `${id.replace('_', ' ').toUpperCase()} — flexion (°)`
  }

  function resetChart() {
    chart?.destroy()
    chartEl.replaceChildren()
    chart = createStreamChart(chartEl, { yRange: [0, 130], windowMs: 10_000, height: 220 })
    const s = tracker.series(selected)
    for (let i = 0; i < s.t.length; i++) chart.push(s.t[i]!, s.v[i]!)
    chartTitle.textContent = chartLabel(selected)
  }

  // --- joint table ---
  const cells = new Map<JointId, HTMLElement>()
  const table = h(
    'table',
    { class: 'joint-table' },
    h(
      'thead',
      {},
      h('tr', {}, h('th', {}, 'Finger'), ...COLUMN_TITLES.map((c) => h('th', {}, c))),
    ),
    h(
      'tbody',
      {},
      ...FINGERS.map((finger) =>
        h(
          'tr',
          {},
          h('td', { class: 'finger-name' }, finger),
          ...JOINT_COLUMNS[finger].map((id) => {
            const cell = h(
              'td',
              {
                class: 'joint-cell',
                tabindex: 0,
                onclick: () => {
                  cells.get(selected)?.classList.remove('selected')
                  selected = id
                  cells.get(id)?.classList.add('selected')
                  resetChart()
                },
              },
              '—',
            )
            cells.set(id, cell)
            return cell
          }),
        ),
      ),
    ),
  )
  cells.get(selected)?.classList.add('selected')

  function renderTable() {
    const s = tracker.summaries()
    for (const id of JOINT_IDS) {
      const cell = cells.get(id)!
      const j = s[id]
      cell.replaceChildren(
        h('div', { class: 'joint-current' }, fmt(j.currentDeg, 0, '°')),
        h('div', { class: 'joint-rom' }, `ROM ${fmt(j.romDeg, 0, '°')}`),
      )
    }
    const j = s[selected]
    detailEl.textContent =
      `min ${fmt(j.minDeg, 0, '°')} · max ${fmt(j.maxDeg, 0, '°')} · ` +
      `ROM ${fmt(j.romDeg, 0, '°')} · peak ω ${fmt(j.peakAngVelDegS, 0, '°/s')}`
  }

  const unsub = ctx.source.subscribe((f) => {
    tracker.push(f)
    if (f.handedness) lastHand = f.handedness
    frames.push(f)
    const cutoff = f.t - FRAME_BUFFER_MS
    if (frames.length > 4 && frames[0]!.t < cutoff) {
      frames = frames.filter((fr) => fr.t >= cutoff)
    }
    if (f.world && chart) {
      const s = tracker.series(selected)
      if (s.t.length > 0) chart.push(s.t[s.t.length - 1]!, s.v[s.v.length - 1]!)
    }
  })
  const tableTimer = setInterval(renderTable, 200)
  resetChart()

  function exportSession() {
    const span = frames.length >= 2 ? frames[frames.length - 1]!.t - frames[0]!.t : 0
    downloadReport(
      buildSessionReport({
        test: 'joint_monitor',
        hand: lastHand,
        startedAt,
        durationMs: span,
        analysis: null,
        jointSummaries: tracker.summaries(),
        frames,
      }),
    )
  }

  const el = h(
    'div',
    { class: 'screen monitor-screen' },
    h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        {},
        h('h2', {}, 'Joint Monitor'),
        h('p', { class: 'muted' }, 'Flexion per joint · click a cell to chart it'),
      ),
      h(
        'div',
        { class: 'header-actions' },
        h('button', { class: 'btn ghost', onclick: () => { tracker.reset(); renderTable() } }, 'Reset ROM'),
        h('button', { class: 'btn ghost', onclick: exportSession }, 'Export JSON'),
        h('button', { class: 'btn primary', onclick: () => ctx.navigate({ name: 'home' }) }, 'Home'),
      ),
    ),
    table,
    chartTitle,
    detailEl,
    chartEl,
  )

  return {
    el,
    destroy() {
      unsub()
      clearInterval(tableTimer)
      chart?.destroy()
    },
  }
}
