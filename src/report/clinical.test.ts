import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REFERENCE_THRESHOLDS,
  type ReferenceThresholds,
} from '../analysis/thresholds'
import { computeRomMetrics } from '../metrics/rom'
import { computeTapMetrics } from '../metrics/taps'
import { computeTremorMetrics } from '../metrics/tremor'
import { makeRomSweepFrames, makeTapFrames, makeTremorFrames } from '../replay/synthetic'
import type { Subject, StoredResult } from '../store/subjects'
import type { Hand } from '../types'
import { buildSessionReportModel, buildSubjectReportModel, REPORT_DISCLAIMER } from './clinical'
import { buildSessionReport } from './export'

const subject: Subject = {
  id: 'subj-1',
  code: 'P001',
  name: 'Maria',
  sex: 'female',
  birthYear: 1958,
  dominantHand: 'right',
  diagnosis: 'PD, H&Y 2',
  notes: 'subject-level note',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const DAY0 = Date.UTC(2026, 0, 1)
const dayIso = (offsetDays: number, hour = 10) =>
  new Date(DAY0 + offsetDays * 86_400_000 + hour * 3_600_000).toISOString()

function makeTapResult(
  id: string,
  hand: Hand,
  startedAt: string,
  opts: { freqHz?: number; decrementPct?: number; notes?: string } = {},
): StoredResult {
  const durationMs = 4000
  const { frames } = makeTapFrames({
    freqHz: opts.freqHz ?? 2,
    durationMs,
    ...(opts.decrementPct !== undefined ? { decrementPct: opts.decrementPct } : {}),
  })
  const report = buildSessionReport({
    test: 'finger_tap',
    hand,
    startedAt,
    durationMs,
    analysis: computeTapMetrics(frames),
    frames,
    ...(opts.notes ? { notes: opts.notes } : {}),
  })
  return {
    id,
    subjectId: subject.id,
    testId: 'finger_tap',
    hand,
    source: 'live',
    startedAt: report.startedAt,
    report,
  }
}

function makeJointResult(id: string, hand: Hand, startedAt: string): StoredResult {
  const report = buildSessionReport({
    test: 'joint_monitor',
    hand,
    startedAt,
    durationMs: 5000,
    analysis: null,
    frames: [],
  })
  return {
    id,
    subjectId: subject.id,
    testId: 'joint_monitor',
    hand,
    source: 'live',
    startedAt,
    report,
  }
}

function makeRomResult(id: string, hand: Hand, startedAt: string): StoredResult {
  const durationMs = 10_000
  const { frames } = makeRomSweepFrames({ durationMs })
  const report = buildSessionReport({
    test: 'rom_test',
    hand,
    startedAt,
    durationMs,
    analysis: computeRomMetrics(frames),
    frames,
  })
  return {
    id,
    subjectId: subject.id,
    testId: 'rom_test',
    hand,
    source: 'live',
    startedAt,
    report,
  }
}

function makeTremorResult(id: string, hand: Hand, startedAt: string): StoredResult {
  const durationMs = 15_000
  const { frames } = makeTremorFrames({ durationMs })
  const report = buildSessionReport({
    test: 'tremor_postural',
    hand,
    startedAt,
    durationMs,
    analysis: computeTremorMetrics(frames),
    frames,
  })
  return {
    id,
    subjectId: subject.id,
    testId: 'tremor_postural',
    hand,
    source: 'live',
    startedAt,
    report,
  }
}

describe('buildSessionReportModel', () => {
  it('returns null for a joint_monitor result (no cycle metrics)', () => {
    const r = makeJointResult('j1', 'right', dayIso(0))
    expect(buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)).toBeNull()
  })

  it('builds header fields, preferring the live Subject over the frozen report.subject', () => {
    const r = makeTapResult('r1', 'right', dayIso(0))
    const model = buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(model.header.subjectCode).toBe('P001')
    expect(model.header.subjectLine).toContain('Maria')
    expect(model.header.subjectLine).toContain('PD, H&Y 2')
    expect(model.header.testTitle).toBe('Finger Tapping Test')
    expect(model.header.hand).toBe('right')
    expect(model.header.durationMs).toBe(4000)
    expect(model.header.source).toBe('live')
    expect(model.header.sourceFileName).toBeNull()
    expect(model.header.appVersion.length).toBeGreaterThan(0)
  })

  it('falls back to null subject fields when no subject is available', () => {
    const r = makeTapResult('r1', 'right', dayIso(0))
    const model = buildSessionReportModel(r, null, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(model.header.subjectCode).toBeNull()
    expect(model.header.subjectLine).toBeNull()
  })

  it('emits all 12 catalog metrics in catalog order', () => {
    const r = makeTapResult('r1', 'right', dayIso(0))
    const model = buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(model.metrics).toHaveLength(12)
    expect(model.metrics.map((row) => row.key)).toEqual([
      'count',
      'frequencyHz',
      'amplitudeMean',
      'amplitudeMax',
      'closingVelMean',
      'closingVelPeak',
      'openingVelMean',
      'ampDecrementPct',
      'velDecrementPct',
      'itiCvPct',
      'hesitationCount',
      'itiMeanMs',
    ])
  })

  it('flags a metric row when it crosses the default thresholds, spares a clean run', () => {
    const decrement = makeTapResult('r1', 'right', dayIso(0), { decrementPct: 30 })
    const clean = makeTapResult('r2', 'right', dayIso(1), { decrementPct: 0 })
    const decrementModel = buildSessionReportModel(decrement, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    const cleanModel = buildSessionReportModel(clean, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    const decrementRow = decrementModel.metrics.find((r) => r.key === 'ampDecrementPct')!
    const cleanRow = cleanModel.metrics.find((r) => r.key === 'ampDecrementPct')!
    expect(decrementRow.flag).toBe('above')
    expect(decrementRow.cue).toBe('> 20%')
    expect(cleanRow.flag).toBeNull()
  })

  it('flags a metric row against a user-configured threshold (roadmap AC: frequencyHz.warnBelow=3)', () => {
    const r = makeTapResult('r1', 'right', dayIso(0), { freqHz: 2 })
    const thresholds: ReferenceThresholds = { frequencyHz: { warnBelow: 3 } }
    const model = buildSessionReportModel(r, subject, thresholds)!
    const freqRow = model.metrics.find((row) => row.key === 'frequencyHz')!
    expect(freqRow.flag).toBe('below')
    expect(freqRow.cue).toBe('< 3 Hz')
  })

  it('never flags with an empty thresholds object', () => {
    const r = makeTapResult('r1', 'right', dayIso(0), { decrementPct: 30 })
    const model = buildSessionReportModel(r, subject, {})!
    expect(model.metrics.every((row) => row.flag === null)).toBe(true)
    expect(model.metrics.every((row) => row.cue === null)).toBe(true)
  })

  it('surfaces quality strip and warnings from the stored quality metrics', () => {
    const r = makeTapResult('r1', 'right', dayIso(0))
    // Mutate the already-built report's quality (not metrics) to exercise
    // the warning thresholds without needing a real low-quality recording.
    r.report.quality = {
      meanFps: 10,
      detectionRate: 0.5,
      droppedIntervals: 2,
      handScaleCvPct: 40,
    }
    const model = buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(model.quality).toEqual([
      { label: 'Mean FPS', value: '10' },
      { label: 'Detection rate', value: '50%' },
      { label: 'Hand-scale CV', value: '40%' },
      { label: 'Dropped intervals', value: '2' },
    ])
    expect(model.qualityWarnings.length).toBeGreaterThanOrEqual(2)
    expect(model.qualityWarnings.some((w) => w.includes('Low frame rate'))).toBe(true)
    expect(model.qualityWarnings.some((w) => w.includes('Hand position varied'))).toBe(true)
  })

  it('reads chart data straight from the stored report (never recomputes)', () => {
    const r = makeTapResult('r1', 'right', dayIso(0))
    const model = buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    if (model.charts.kind !== 'cycle') throw new Error('expected cycle charts')
    expect(model.charts.signal).toBe(r.report.series)
    expect(model.charts.events).toBe(r.report.events)
    expect(model.charts.amplitudes).toHaveLength(r.report.events.length)
    expect(model.charts.intervals).toHaveLength(Math.max(0, r.report.events.length - 1))
  })

  it('propagates notes and always carries the disclaimer', () => {
    const withNotes = makeTapResult('r1', 'right', dayIso(0), { notes: 'fatigue after set 3' })
    const withoutNotes = makeTapResult('r2', 'right', dayIso(1))
    const modelWith = buildSessionReportModel(withNotes, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    const modelWithout = buildSessionReportModel(withoutNotes, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(modelWith.notes).toBe('fatigue after set 3')
    expect(modelWithout.notes).toBeNull()
    expect(modelWith.disclaimer).toBe(REPORT_DISCLAIMER)
  })

  it('building a report never mutates the stored result', () => {
    const r = makeTapResult('r1', 'right', dayIso(0))
    const before = JSON.stringify(r)
    buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('builds a rom-kind model for a ROM result: catalog rows + reference-based charts', () => {
    const r = makeRomResult('rom1', 'right', dayIso(0))
    const model = buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(model.header.testTitle).toBe('Range of Motion Test')
    // ROM_CATALOG rows in order: total + 5 fingers.
    expect(model.metrics.map((m) => m.key)).toEqual([
      'romTotalDeg',
      'romThumbDeg',
      'romIndexDeg',
      'romMiddleDeg',
      'romRingDeg',
      'romPinkyDeg',
    ])
    expect(model.metrics[0]!.value).not.toBeNull()
    expect(model.metrics[0]!.value!).toBeGreaterThan(800)
    if (model.charts.kind !== 'rom') throw new Error('expected rom charts')
    expect(model.charts.trace).toBe(r.report.series)
    expect(model.charts.perFinger).toHaveLength(5)
    expect(model.charts.joints).toBe((r.report.metrics as { joints: unknown }).joints)
    // The cycle-only "very few events" warning must not fire for ROM.
    expect(model.qualityWarnings.some((w) => w.includes('Very few events'))).toBe(false)
  })

  it('flags a ROM metric via a romTotalDeg threshold', () => {
    const r = makeRomResult('rom1', 'right', dayIso(0))
    const thresholds: ReferenceThresholds = { romTotalDeg: { warnBelow: 2000 } }
    const model = buildSessionReportModel(r, subject, thresholds)!
    const total = model.metrics.find((m) => m.key === 'romTotalDeg')!
    expect(total.flag).toBe('below')
    expect(total.cue).toBe('< 2000°')
  })

  it('building a ROM report never mutates the stored result', () => {
    const r = makeRomResult('rom1', 'right', dayIso(0))
    const before = JSON.stringify(r)
    buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)
    expect(JSON.stringify(r)).toBe(before)
  })

  it('builds a tremor-kind model with a PSD derived from the stored series', () => {
    const r = makeTremorResult('t1', 'right', dayIso(0))
    const model = buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)!
    expect(model.header.testTitle).toBe('Postural Tremor Test')
    expect(model.metrics.map((m) => m.key)).toEqual([
      'tremorDominantFreqHz',
      'tremorRmsAmpCm',
      'tremorPeakAmpCm',
      'tremorIndexPct',
      'tremorBandPower',
    ])
    const freq = model.metrics.find((m) => m.key === 'tremorDominantFreqHz')!
    expect(freq.value).not.toBeNull()
    expect(Math.abs(freq.value! - 5)).toBeLessThan(0.3)
    if (model.charts.kind !== 'tremor') throw new Error('expected tremor charts')
    expect(model.charts.displacement).toBe(r.report.series)
    expect(model.charts.psd.freqHz.length).toBeGreaterThan(0)
    expect(model.charts.bandHz).toEqual([3, 12])
    // The cycle-only few-events warning must not fire for tremor.
    expect(model.qualityWarnings.some((w) => w.includes('Very few events'))).toBe(false)
  })

  it('building a tremor report (incl. PSD derivation) never mutates the stored result', () => {
    const r = makeTremorResult('t1', 'right', dayIso(0))
    const before = JSON.stringify(r)
    buildSessionReportModel(r, subject, DEFAULT_REFERENCE_THRESHOLDS)
    expect(JSON.stringify(r)).toBe(before)
  })
})

describe('buildSubjectReportModel', () => {
  it('only includes tests with at least one cycle-metrics result', () => {
    const results = [makeTapResult('r1', 'right', dayIso(0))]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, dayIso(5))
    expect(model.tests).toHaveLength(1)
    expect(model.tests[0]!.testId).toBe('finger_tap')
  })

  it('degrades gracefully with a single result total (no blank sections)', () => {
    const results = [makeTapResult('r1', 'right', dayIso(0))]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, dayIso(5))
    const test = model.tests[0]!
    expect(test.latest).toHaveLength(1)
    expect(test.latest[0]!.hand).toBe('right')
    expect(test.trends).toEqual([])
    expect(test.asymmetry).toBeNull()
    expect(model.sessions).toHaveLength(1)
    expect(model.disclaimer).toBe(REPORT_DISCLAIMER)
  })

  it('reports latest-per-hand metrics (0-2 entries), most recent result wins per hand', () => {
    const results = [
      makeTapResult('r-old', 'right', dayIso(0), { freqHz: 1.8 }),
      makeTapResult('r-new', 'right', dayIso(1), { freqHz: 2.2 }),
      makeTapResult('l1', 'left', dayIso(1)),
    ]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, dayIso(5))
    const test = model.tests[0]!
    expect(test.latest).toHaveLength(2)
    const right = test.latest.find((l) => l.hand === 'right')!
    expect(right.startedAt).toBe(dayIso(1))
    const freqRow = right.metrics.find((m) => m.key === 'frequencyHz')!
    expect(freqRow.value).toBeCloseTo(2.2, 1)
  })

  it('includes trend series only for spark metrics with >=2 non-null points on some hand', () => {
    const results = [
      makeTapResult('r0', 'right', dayIso(0), { freqHz: 2.0 }),
      makeTapResult('r1', 'right', dayIso(10), { freqHz: 2.1 }),
      makeTapResult('l0', 'left', dayIso(0)), // single left point — not enough on its own
    ]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, dayIso(20))
    const test = model.tests[0]!
    const freqTrend = test.trends.find((t) => t.key === 'frequencyHz')!
    expect(freqTrend).toBeDefined()
    const rightSeries = freqTrend.series.find((s) => s.hand === 'right')
    const leftSeries = freqTrend.series.find((s) => s.hand === 'left')
    expect(rightSeries).toBeDefined()
    expect(rightSeries!.points).toHaveLength(2)
    expect(leftSeries).toBeUndefined() // left only has 1 point, excluded
  })

  it('reports the latest complete (both-hands) same-day pair as asymmetry, not just the latest day', () => {
    const results = [
      // Complete pair on day 0.
      makeTapResult('r0', 'right', dayIso(0), { freqHz: 2.0 }),
      makeTapResult('l0', 'left', dayIso(0), { freqHz: 1.6 }),
      // Right-only on day 1 (more recent, but incomplete).
      makeTapResult('r1', 'right', dayIso(1), { freqHz: 2.4 }),
    ]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, dayIso(5))
    const test = model.tests[0]!
    expect(test.asymmetry).not.toBeNull()
    expect(test.asymmetry!.dayKey).toBe('2026-01-01')
    const freqRow = test.asymmetry!.rows.find((r) => r.key === 'frequencyHz')!
    expect(freqRow.value).not.toBeNull()
    expect(freqRow.value!).toBeGreaterThan(0) // right (2.0) > left (1.6)
  })

  it('lists every stored result (including joint_monitor) in the sessions table, newest first', () => {
    const results = [
      makeTapResult('r0', 'right', dayIso(0)),
      makeJointResult('j0', 'right', dayIso(1)),
      makeTapResult('r1', 'right', dayIso(2), { notes: 'good session' }),
    ]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, dayIso(5))
    expect(model.sessions).toHaveLength(3)
    expect(model.sessions.map((s) => s.startedAt)).toEqual([dayIso(2), dayIso(1), dayIso(0)])
    expect(model.sessions[0]!.notes).toBe('good session')
    expect(model.sessions[1]!.testTitle).toBe('Joint Monitor')
    expect(model.sessions[1]!.summary).toBe('Joint range-of-motion session')
  })

  it('carries subject identity and a fixed generatedAt (deterministic, no clock read)', () => {
    const results = [makeTapResult('r1', 'right', dayIso(0))]
    const model = buildSubjectReportModel(subject, results, DEFAULT_REFERENCE_THRESHOLDS, '2026-02-01T00:00:00.000Z')
    expect(model.subject).toEqual({ code: 'P001', line: model.subject.line, notes: 'subject-level note' })
    expect(model.subject.line).toContain('Maria')
    expect(model.generatedAt).toBe('2026-02-01T00:00:00.000Z')
  })
})
