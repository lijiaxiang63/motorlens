// Results: metric cards, quality warnings, and three charts (signal with
// closure markers, per-event amplitude with trend, inter-event intervals).

import { HAND_SCALE_CV_WARN_PCT } from '../../config'
import { buildSessionReport, downloadReport } from '../../report/export'
import type { AppContext, ResultProps, ScreenInstance } from '../app'
import { createEventChart, createSignalChart, type StaticChart } from '../liveChart'
import { fmt, h, metricCard } from '../components'

export function createResultsScreen(ctx: AppContext, r: ResultProps): ScreenInstance {
  const { def, hand, analysis } = r
  const m = analysis.metrics
  const q = analysis.quality
  const report = buildSessionReport({
    test: def.id,
    hand,
    startedAt: r.startedAt,
    durationMs: def.durationMs,
    analysis,
    frames: r.frames,
  })
  // Exposed for automated verification and debugging.
  ;(window as unknown as Record<string, unknown>).__lastReport = report

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

  // --- metric cards ---
  const noun = def.eventNoun[1]
  const cmSub = (units: number | null, digits = 1) =>
    units !== null && m.cmPerUnit !== null ? `≈ ${(units * m.cmPerUnit).toFixed(digits)} cm` : undefined
  const cmVelSub = (units: number | null) =>
    units !== null && m.cmPerUnit !== null ? `≈ ${(units * m.cmPerUnit).toFixed(0)} cm/s` : undefined

  const cards = h(
    'div',
    { class: 'metrics-grid' },
    metricCard(noun, String(m.count), `in ${def.durationMs / 1000} s`, 'accent'),
    metricCard('Frequency', fmt(m.frequencyHz, 2, ' Hz')),
    metricCard('Amplitude (mean)', fmt(m.amplitudeMean, 2), cmSub(m.amplitudeMean)),
    metricCard('Amplitude (max)', fmt(m.amplitudeMax, 2), cmSub(m.amplitudeMax)),
    metricCard(`${def.closingLabel} (mean)`, fmt(m.closingVelMean, 1, ' u/s'), cmVelSub(m.closingVelMean)),
    metricCard(`${def.closingLabel} (peak)`, fmt(m.closingVelPeak, 1, ' u/s'), cmVelSub(m.closingVelPeak)),
    metricCard(`${def.openingLabel} (mean)`, fmt(m.openingVelMean, 1, ' u/s'), cmVelSub(m.openingVelMean)),
    metricCard(
      'Amplitude decrement',
      fmt(m.amplitudeDecrement.regressionPct, 0, '%'),
      m.amplitudeDecrement.thirdsPct !== null
        ? `thirds: ${fmt(m.amplitudeDecrement.thirdsPct, 0, '%')}`
        : undefined,
      (m.amplitudeDecrement.regressionPct ?? 0) > 20 ? 'warn' : undefined,
    ),
    metricCard('Velocity decrement', fmt(m.velocityDecrement.regressionPct, 0, '%')),
    metricCard('Rhythm variability', fmt(m.rhythm.itiCvPct, 0, '%'), 'CV of intervals'),
    metricCard(
      'Hesitations',
      String(m.rhythm.hesitationCount),
      m.rhythm.longestPauseMs !== null
        ? `longest pause ${fmt(m.rhythm.longestPauseMs / 1000, 2, ' s')}`
        : undefined,
      m.rhythm.hesitationCount > 0 ? 'warn' : undefined,
    ),
    metricCard('Mean interval', fmt(m.rhythm.itiMeanMs, 0, ' ms')),
  )

  // --- charts ---
  const signalEl = h('div', { class: 'chart-panel' })
  const ampEl = h('div', { class: 'chart-panel half' })
  const itiEl = h('div', { class: 'chart-panel half' })
  const charts: StaticChart[] = []

  const itis: number[] = []
  for (let i = 1; i < analysis.events.length; i++) {
    const a = analysis.events[i - 1]!
    const b = analysis.events[i]!
    if (a.segment === b.segment) itis.push(b.tMs - a.tMs)
  }

  queueMicrotask(() => {
    charts.push(createSignalChart(signalEl, analysis.signal, analysis.events, def.signalLabel))
    charts.push(
      createEventChart(ampEl, analysis.events.map((e) => e.closingAmplitude), 'amplitude (hand units)', {
        trend: true,
      }),
    )
    charts.push(createEventChart(itiEl, itis, 'interval (ms)'))
  })

  const startedDate = new Date(r.startedAt)
  const el = h(
    'div',
    { class: 'screen results-screen' },
    h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        {},
        h('h2', {}, `${def.title} — results`),
        h(
          'p',
          { class: 'muted' },
          `${hand === 'left' ? 'Left' : 'Right'} hand · ${startedDate.toLocaleString()} · ` +
            `${fmt(q.meanFps, 0)} fps · ${(q.detectionRate * 100).toFixed(0)}% detection`,
        ),
      ),
      h(
        'div',
        { class: 'header-actions' },
        h('button', { class: 'btn ghost', onclick: () => downloadReport(report) }, 'Export JSON'),
        h('button', { class: 'btn ghost', onclick: () => window.print() }, 'Print'),
        h(
          'button',
          { class: 'btn ghost', onclick: () => ctx.navigate({ name: 'record', def, hand }) },
          'Repeat test',
        ),
        h('button', { class: 'btn primary', onclick: () => ctx.navigate({ name: 'home' }) }, 'Home'),
      ),
    ),
    warnings.length > 0
      ? h('div', { class: 'warning-banner' }, ...warnings.map((w) => h('div', {}, `⚠ ${w}`)))
      : null,
    cards,
    h('h3', { class: 'section-title' }, 'Signal'),
    signalEl,
    h(
      'div',
      { class: 'chart-row' },
      h('div', {}, h('h3', { class: 'section-title' }, 'Amplitude per event'), ampEl),
      h('div', {}, h('h3', { class: 'section-title' }, 'Interval per event'), itiEl),
    ),
  )

  return {
    el,
    destroy() {
      for (const c of charts) c.destroy()
    },
  }
}
