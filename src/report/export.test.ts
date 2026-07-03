import { describe, expect, it } from 'vitest'
import { computePronosupMetrics } from '../metrics/pronosup'
import { computeTapMetrics } from '../metrics/taps'
import { computeTremorMetrics } from '../metrics/tremor'
import { makePronosupFrames, makeTapFrames, makeTremorFrames } from '../replay/synthetic'
import type { ReportSource, ReportSubject, TremorMetrics } from '../types'
import { buildSessionReport, parseSessionJson, reportFileName } from './export'

const startedAt = '2026-07-02T10:15:02.000Z'

function buildBase(extra?: { subject?: ReportSubject; source?: ReportSource; notes?: string }) {
  const { frames } = makeTapFrames({ freqHz: 2, durationMs: 4000 })
  return buildSessionReport({
    test: 'finger_tap',
    hand: 'right',
    startedAt,
    durationMs: 4000,
    analysis: computeTapMetrics(frames),
    frames,
    ...(extra ?? {}),
  })
}

describe('session report round-trip', () => {
  it('keeps reports without subject/source byte-identical to the legacy shape', () => {
    const report = buildBase()
    expect('subject' in report).toBe(false)
    expect('source' in report).toBe(false)
    const keys = Object.keys(report)
    expect(keys).toEqual([
      'schemaVersion',
      'app',
      'test',
      'hand',
      'startedAt',
      'durationMs',
      'quality',
      'metrics',
      'series',
      'events',
      'raw',
    ])
  })

  it('preserves subject and source through JSON export → parse', () => {
    const report = buildBase({
      subject: { code: 'P001', name: 'Maria', birthYear: 1958, dominantHand: 'right' },
      source: { kind: 'video', fileName: 'clip.mp4', segmentStartMs: 1200, segmentEndMs: 9800 },
    })
    const parsed = parseSessionJson(JSON.stringify(report))
    expect(parsed.subject).toEqual(report.subject)
    expect(parsed.source).toEqual(report.source)
    expect(parsed.raw.frames.length).toBe(report.raw.frames.length)
  })

  it('recomputes identical metrics from exported raw frames', () => {
    const report = buildBase()
    const parsed = parseSessionJson(JSON.stringify(report))
    const re = computeTapMetrics(parsed.raw.frames)
    expect(re.metrics.count).toBe((report.metrics as { count: number }).count)
    expect(re.metrics.frequencyHz).toBeCloseTo(
      (report.metrics as { frequencyHz: number }).frequencyHz,
      6,
    )
  })

  it('recomputes identical pronation-supination metrics from exported raw frames', () => {
    // The roll extractor (cross product + atan2 + unwrap) must survive the
    // 4-dp world-coordinate rounding on export like the hand-unit extractors:
    // count exact, frequency to 1e-6 (the locked round-trip contract).
    const { frames } = makePronosupFrames({ freqHz: 1, durationMs: 4000 })
    const report = buildSessionReport({
      test: 'pronation_supination',
      hand: 'right',
      startedAt,
      durationMs: 4000,
      analysis: computePronosupMetrics(frames),
      frames,
    })
    const parsed = parseSessionJson(JSON.stringify(report))
    const re = computePronosupMetrics(parsed.raw.frames)
    expect(re.metrics.count).toBe((report.metrics as { count: number }).count)
    expect(re.metrics.frequencyHz).toBeCloseTo(
      (report.metrics as { frequencyHz: number }).frequencyHz,
      6,
    )
    expect(re.metrics.cmPerUnit).toBeNull()
  })

  it('recomputes identical rest-tremor metrics from exported raw frames', () => {
    // The finger channel reads thumb–index distances off the 4-dp-rounded
    // world coordinates; the centroid channels ride the LS cm fit. Dominant
    // frequency must land on the identical PSD bin; amplitudes to ~1%.
    const { frames } = makeTremorFrames({
      ampCm: 0.3,
      finger: { freqHz: 5, ampCm: 0.5 },
      durationMs: 8_000,
    })
    const compute = (fs: typeof frames) => computeTremorMetrics(fs, { fingerChannel: true })
    const report = buildSessionReport({
      test: 'tremor_rest',
      hand: 'right',
      startedAt,
      durationMs: 8_000,
      analysis: compute(frames),
      frames,
    })
    const parsed = parseSessionJson(JSON.stringify(report))
    const re = compute(parsed.raw.frames)
    const m = report.metrics as TremorMetrics
    expect(re.metrics.dominantFreqHz).toBeCloseTo(m.dominantFreqHz!, 6)
    expect(
      Math.abs(re.metrics.rmsAmplitudeCm! - m.rmsAmplitudeCm!) / m.rmsAmplitudeCm!,
    ).toBeLessThan(0.01)
  })

  it('derives a stable filename from test, hand, and start time', () => {
    const report = buildBase()
    expect(reportFileName(report)).toMatch(/^motorlens_finger_tap_right_\d{8}-\d{6}\.json$/)
  })

  it('keeps reports without notes free of the key (byte-identity preserved)', () => {
    const report = buildBase()
    expect('notes' in report).toBe(false)
  })

  it('preserves notes through JSON export → parse', () => {
    const report = buildBase({ notes: 'Patient reported fatigue after set 3.' })
    const parsed = parseSessionJson(JSON.stringify(report))
    expect(parsed.notes).toBe('Patient reported fatigue after set 3.')
  })
})
