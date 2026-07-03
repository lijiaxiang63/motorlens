// Pure clinical report model (Phase 3): StoredResult(s) + reference
// thresholds -> a plain data model the report screen renders and Electron's
// printToPDF snapshots. No DOM, no recompute from raw frames — session
// metrics/series/events are read straight off the stored report, so
// generating a report can never mutate (or even touch) the stored result.

import { APP_VERSION, HAND_SCALE_CV_WARN_PCT } from '../config'
import { TEST_DEFS, testDefById } from '../protocol/definitions'
import type { Subject, StoredResult } from '../store/subjects'
import type { CycleEvent, Hand, QualityMetrics, ReportSubject, Series, SessionReport, TestId } from '../types'
import { asymmetryForPair, type AsymmetryRow } from '../analysis/asymmetry'
import {
  catalogFor,
  cycleMetricsOf,
  formatMetric,
  metricByKey,
  metricValue,
  reportMetrics,
  type MetricKey,
} from '../analysis/metricCatalog'
import { pairResults } from '../analysis/pairing'
import {
  evaluateThreshold,
  formatThresholdCue,
  type ReferenceThresholds,
  type ThresholdFlag,
} from '../analysis/thresholds'
import { buildTrend, type TrendPoint } from '../analysis/trends'

export const REPORT_DISCLAIMER =
  'Reference values are user-configured and are not validated clinical norms. This report does not constitute a diagnosis.'

export interface ReportMetricRow {
  key: MetricKey
  label: string
  display: string
  value: number | null
  flag: ThresholdFlag
  /** Short readable threshold text ("> 20%"), or null when no cue is set. */
  cue: string | null
}

export interface SessionReportHeader {
  subjectCode: string | null
  subjectLine: string | null
  testTitle: string
  hand: Hand
  startedAt: string
  durationMs: number
  appVersion: string
  source: 'live' | 'video'
  sourceFileName: string | null
}

export interface SessionReportModel {
  kind: 'session'
  header: SessionReportHeader
  quality: { label: string; value: string }[]
  qualityWarnings: string[]
  metrics: ReportMetricRow[]
  charts: {
    signal: Series
    events: CycleEvent[]
    signalLabel: string
    amplitudes: number[]
    intervals: number[]
  }
  notes: string | null
  disclaimer: string
}

export interface SubjectReportModel {
  kind: 'subject'
  subject: { code: string; line: string | null; notes: string | null }
  generatedAt: string
  appVersion: string
  tests: {
    testId: TestId
    testTitle: string
    /** 0–2 entries: the latest result per hand for this test. */
    latest: { hand: Hand; startedAt: string; metrics: ReportMetricRow[] }[]
    /** Only spark-catalog metrics with ≥2 non-null points on some hand. */
    trends: { key: MetricKey; label: string; series: { hand: Hand; points: TrendPoint[] }[] }[]
    /** The most recent day with both hands recorded, or null if none exists. */
    asymmetry: { dayKey: string; rows: AsymmetryRow[] } | null
  }[]
  /** Every stored result (including joint_monitor), newest first. */
  sessions: {
    startedAt: string
    testTitle: string
    hand: Hand
    source: 'live' | 'video'
    summary: string
    notes: string | null
  }[]
  disclaimer: string
}

function buildMetricRows(
  report: SessionReport,
  thresholds: ReferenceThresholds,
): ReportMetricRow[] {
  return catalogFor(report.test).map((def) => {
    const value = metricValue(def, report)
    const t = thresholds[def.key]
    return {
      key: def.key,
      label: def.label,
      display: formatMetric(def, value),
      value,
      flag: evaluateThreshold(t, value),
      cue: t ? formatThresholdCue(def, t) : null,
    }
  })
}

function buildQualityStrip(q: QualityMetrics): { label: string; value: string }[] {
  return [
    { label: 'Mean FPS', value: q.meanFps.toFixed(0) },
    { label: 'Detection rate', value: `${(q.detectionRate * 100).toFixed(0)}%` },
    { label: 'Hand-scale CV', value: `${q.handScaleCvPct.toFixed(0)}%` },
    { label: 'Dropped intervals', value: String(q.droppedIntervals) },
  ]
}

/** Mirrors ResultsScreen's on-screen warning rules (minus videoCaptureFailed,
 *  which is a live-session UI concern, not part of the stored report). */
function buildQualityWarnings(q: QualityMetrics, count: number): string[] {
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
  if (count < 4) {
    warnings.push('Very few events detected — decrement and rhythm metrics need more repetitions.')
  }
  return warnings
}

function subjectLineFromSubject(s: Subject): string | null {
  const bits: string[] = []
  if (s.name) bits.push(s.name)
  if (s.sex) bits.push(s.sex)
  if (s.birthYear !== null) bits.push(`b.${s.birthYear}`)
  if (s.dominantHand) bits.push(`dominant hand: ${s.dominantHand}`)
  if (s.diagnosis) bits.push(s.diagnosis)
  return bits.length > 0 ? bits.join(' · ') : null
}

function subjectLineFromReportSubject(s: ReportSubject): string | null {
  const bits: string[] = []
  if (s.name) bits.push(s.name)
  if (s.sex) bits.push(s.sex)
  if (s.birthYear !== undefined) bits.push(`b.${s.birthYear}`)
  if (s.dominantHand) bits.push(`dominant hand: ${s.dominantHand}`)
  if (s.diagnosis) bits.push(s.diagnosis)
  return bits.length > 0 ? bits.join(' · ') : null
}

/** Builds a per-session clinical report model from an already-stored result.
 *  Read-only: metrics/series/events come straight from `result.report`
 *  (never recomputed), so building a report cannot mutate the stored result.
 *  Returns null when the result has no cycle metrics (e.g. joint_monitor) —
 *  those have no per-session report, only a row in the subject summary. */
export function buildSessionReportModel(
  result: StoredResult,
  subject: Subject | null,
  thresholds: ReferenceThresholds,
): SessionReportModel | null {
  const report = result.report
  const m = cycleMetricsOf(report)
  if (m === null) return null

  const itis: number[] = []
  for (let i = 1; i < report.events.length; i++) {
    const a = report.events[i - 1]!
    const b = report.events[i]!
    if (a.segment === b.segment) itis.push(b.tMs - a.tMs)
  }
  const amplitudes = report.events.map((e) => e.closingAmplitude)
  const def = testDefById(result.testId)

  return {
    kind: 'session',
    header: {
      subjectCode: subject?.code ?? report.subject?.code ?? null,
      subjectLine: subject
        ? subjectLineFromSubject(subject)
        : report.subject
          ? subjectLineFromReportSubject(report.subject)
          : null,
      testTitle: def?.title ?? result.testId,
      hand: result.hand,
      startedAt: result.startedAt,
      durationMs: report.durationMs,
      appVersion: report.app.version,
      source: result.source,
      sourceFileName: report.source?.fileName ?? null,
    },
    quality: report.quality ? buildQualityStrip(report.quality) : [],
    qualityWarnings: report.quality ? buildQualityWarnings(report.quality, m.count) : [],
    metrics: buildMetricRows(report, thresholds),
    charts: {
      signal: report.series,
      events: report.events,
      signalLabel: def?.signalLabel ?? 'signal',
      amplitudes,
      intervals: itis,
    },
    notes: report.notes ?? null,
    disclaimer: REPORT_DISCLAIMER,
  }
}

function latestByHand(
  results: StoredResult[],
  testId: TestId,
  thresholds: ReferenceThresholds,
): { hand: Hand; startedAt: string; metrics: ReportMetricRow[] }[] {
  const byHand = new Map<Hand, StoredResult>()
  for (const r of results) {
    if (r.testId !== testId || reportMetrics(r.report) === null) continue
    const current = byHand.get(r.hand)
    if (!current || r.startedAt > current.startedAt) byHand.set(r.hand, r)
  }
  const out: { hand: Hand; startedAt: string; metrics: ReportMetricRow[] }[] = []
  for (const hand of ['right', 'left'] as const) {
    const r = byHand.get(hand)
    if (r) {
      out.push({
        hand,
        startedAt: r.startedAt,
        metrics: buildMetricRows(r.report, thresholds),
      })
    }
  }
  return out
}

function buildTrendsSection(
  results: StoredResult[],
  testId: TestId,
): SubjectReportModel['tests'][number]['trends'] {
  const out: SubjectReportModel['tests'][number]['trends'] = []
  for (const def of catalogFor(testId).filter((d) => d.spark)) {
    const series: { hand: Hand; points: TrendPoint[] }[] = []
    for (const hand of ['right', 'left'] as const) {
      const trend = buildTrend(results, testId, hand, def.key)
      const nonNull = trend.points.filter((p) => p.value !== null).length
      if (nonNull >= 2) series.push({ hand, points: trend.points })
    }
    if (series.length > 0) out.push({ key: def.key, label: def.label, series })
  }
  return out
}

function buildAsymmetrySection(
  results: StoredResult[],
  testId: TestId,
): { dayKey: string; rows: AsymmetryRow[] } | null {
  const pair = pairResults(results, testId).find((p) => p.left && p.right)
  return pair ? { dayKey: pair.dayKey, rows: asymmetryForPair(pair) } : null
}

function sessionSummary(r: StoredResult): string {
  const m = cycleMetricsOf(r.report)
  if (!m) return 'Joint range-of-motion session'
  return `${m.count} ${m.count === 1 ? 'event' : 'events'} · ${formatMetric(metricByKey('frequencyHz'), m.frequencyHz)}`
}

/** Builds a per-subject summary report: latest metrics and trends per test ×
 *  hand, the most recent bilateral pair's asymmetry (why Phase 2's analytics
 *  precede this), and a full sessions table. Sections degrade to empty
 *  arrays/null rather than placeholders — a subject with one result gets a
 *  one-row sessions table and no asymmetry/trend sections, never a blank
 *  page. `generatedAt` is a parameter (not read from the clock internally)
 *  so this stays pure and deterministic for tests. */
export function buildSubjectReportModel(
  subject: Subject,
  results: StoredResult[],
  thresholds: ReferenceThresholds,
  generatedAt: string = new Date().toISOString(),
): SubjectReportModel {
  const tests: SubjectReportModel['tests'] = []
  for (const def of TEST_DEFS) {
    const hasAny = results.some((r) => r.testId === def.id && reportMetrics(r.report) !== null)
    if (!hasAny) continue
    tests.push({
      testId: def.id,
      testTitle: def.title,
      latest: latestByHand(results, def.id, thresholds),
      trends: buildTrendsSection(results, def.id),
      asymmetry: buildAsymmetrySection(results, def.id),
    })
  }

  const sessions = results
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((r) => ({
      startedAt: r.startedAt,
      testTitle: testDefById(r.testId)?.title ?? (r.testId === 'joint_monitor' ? 'Joint Monitor' : r.testId),
      hand: r.hand,
      source: r.source,
      summary: sessionSummary(r),
      notes: r.report.notes ?? null,
    }))

  return {
    kind: 'subject',
    subject: { code: subject.code, line: subjectLineFromSubject(subject), notes: subject.notes || null },
    generatedAt,
    appVersion: APP_VERSION,
    tests,
    sessions,
    disclaimer: REPORT_DISCLAIMER,
  }
}
