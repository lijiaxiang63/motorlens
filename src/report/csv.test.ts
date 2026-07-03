import { describe, expect, it } from 'vitest'
import { computePronosupMetrics } from '../metrics/pronosup'
import { computeRomMetrics } from '../metrics/rom'
import { computeTapMetrics } from '../metrics/taps'
import { computeTremorMetrics } from '../metrics/tremor'
import {
  makePronosupFrames,
  makeRomSweepFrames,
  makeTapFrames,
  makeTremorFrames,
} from '../replay/synthetic'
import type { StoredResult, Subject } from '../store/subjects'
import type { TestAnalysis, TestId } from '../types'
import { buildSessionReport } from './export'
import { buildSummaryCsv, buildSummaryRow, SUMMARY_COLUMNS } from './csv'

const subject: Subject = {
  id: 's1',
  code: 'P001',
  name: 'García, "Maria"', // exercises quoting
  sex: 'female',
  birthYear: 1958,
  dominantHand: 'right',
  diagnosis: 'PD, H&Y 2', // exercises comma quoting
  notes: 'line1\nline2', // exercises newline quoting
  createdAt: '2026-07-02T09:00:00.000Z',
}

function makeResult(withVideo: boolean, notes?: string): StoredResult {
  const { frames } = makeTapFrames({ freqHz: 2, durationMs: 4000 })
  const report = buildSessionReport({
    test: 'finger_tap',
    hand: 'right',
    startedAt: '2026-07-02T10:15:02.000Z',
    durationMs: 4000,
    analysis: computeTapMetrics(frames),
    frames,
    ...(notes ? { notes } : {}),
  })
  return {
    id: 'r1',
    subjectId: subject.id,
    testId: 'finger_tap',
    hand: 'right',
    source: 'live',
    startedAt: report.startedAt,
    ...(withVideo ? { videoKey: 'live_r1' } : {}),
    report,
  }
}

function makeFamilyResult(testId: TestId, analysis: TestAnalysis): StoredResult {
  const report = buildSessionReport({
    test: testId,
    hand: 'right',
    startedAt: '2026-07-02T10:15:02.000Z',
    durationMs: 10_000,
    analysis,
    frames: [],
  })
  return {
    id: 'r1',
    subjectId: subject.id,
    testId,
    hand: 'right',
    source: 'live',
    startedAt: report.startedAt,
    report,
  }
}

describe('summary CSV', () => {
  it('emits one cell per column, matching SUMMARY_COLUMNS', () => {
    const row = buildSummaryRow(subject, makeResult(true), 'P001/video.webm', 'P001/report.json')
    expect(row.length).toBe(SUMMARY_COLUMNS.length)
    const get = (col: (typeof SUMMARY_COLUMNS)[number]) => row[SUMMARY_COLUMNS.indexOf(col)]
    expect(get('subject_code')).toBe('P001')
    expect(get('test')).toBe('finger_tap')
    expect(get('hand')).toBe('right')
    expect(get('source')).toBe('live')
    expect(get('duration_ms')).toBe('4000')
    expect(Number(get('count'))).toBeGreaterThan(5)
    expect(Number(get('frequency_hz'))).toBeCloseTo(2, 1)
    expect(get('has_video')).toBe('yes')
    expect(get('video_file')).toBe('P001/video.webm')
    expect(get('report_file')).toBe('P001/report.json')
  })

  it('renders nulls as empty cells and rounds floats to 4 decimals', () => {
    const result = makeResult(false)
    const m = result.report.metrics as { frequencyHz: number | null; amplitudeMeanCm: number | null }
    m.frequencyHz = 1.23456789
    m.amplitudeMeanCm = null
    const row = buildSummaryRow(subject, result, '', '')
    const get = (col: (typeof SUMMARY_COLUMNS)[number]) => row[SUMMARY_COLUMNS.indexOf(col)]
    expect(get('frequency_hz')).toBe('1.2346')
    expect(get('amplitude_mean_cm')).toBe('')
    expect(get('has_video')).toBe('no')
    expect(get('video_file')).toBe('')
  })

  it('produces BOM + CRLF + RFC 4180 quoting', () => {
    const csv = buildSummaryCsv([buildSummaryRow(subject, makeResult(false), '', '')])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(SUMMARY_COLUMNS.join(','))
    // Quoted fields survive: name has quotes+comma, diagnosis a comma, notes a newline.
    expect(csv).toContain('"García, ""Maria"""')
    expect(csv).toContain('"PD, H&Y 2"')
    expect(csv).toContain('"line1\nline2"')
  })

  it('locks the 49-column set: original 38 + result_notes + the Phase 4 tail', () => {
    expect(SUMMARY_COLUMNS.length).toBe(49)
    expect(SUMMARY_COLUMNS[38]).toBe('result_notes')
    // Phase 4 append-only tail (one deliberate update).
    expect(SUMMARY_COLUMNS.slice(39)).toEqual([
      'amplitude_unit',
      'tremor_dominant_freq_hz',
      'tremor_rms_amp_cm',
      'tremor_index_pct',
      'total_active_rom_deg',
      'rom_thumb_deg',
      'rom_index_deg',
      'rom_middle_deg',
      'rom_ring_deg',
      'rom_pinky_deg',
    ])
    // Original 38-column order is unchanged.
    expect(SUMMARY_COLUMNS.slice(0, 38)).toEqual([
      'subject_code',
      'subject_name',
      'sex',
      'birth_year',
      'dominant_hand',
      'diagnosis',
      'notes',
      'test',
      'hand',
      'source',
      'started_at',
      'duration_ms',
      'count',
      'frequency_hz',
      'amplitude_mean',
      'amplitude_max',
      'amplitude_mean_cm',
      'closing_vel_mean',
      'closing_vel_peak',
      'closing_vel_peak_cm_s',
      'opening_vel_mean',
      'opening_vel_peak',
      'amp_decrement_regression_pct',
      'amp_decrement_thirds_pct',
      'vel_decrement_regression_pct',
      'vel_decrement_thirds_pct',
      'iti_mean_ms',
      'iti_cv_pct',
      'hesitation_count',
      'longest_pause_ms',
      'dropped_intervals',
      'cm_per_unit',
      'mean_fps',
      'detection_rate',
      'hand_scale_cv_pct',
      'has_video',
      'video_file',
      'report_file',
    ])
  })

  it('emits result_notes for the per-result note (distinct from subject notes)', () => {
    const withNotes = buildSummaryRow(subject, makeResult(false, 'Patient reported fatigue'), '', '')
    const withoutNotes = buildSummaryRow(subject, makeResult(false), '', '')
    const get = (row: string[], col: (typeof SUMMARY_COLUMNS)[number]) =>
      row[SUMMARY_COLUMNS.indexOf(col)]
    expect(get(withNotes, 'result_notes')).toBe('Patient reported fatigue')
    expect(get(withNotes, 'notes')).toBe('line1\nline2') // subject notes untouched
    expect(get(withoutNotes, 'result_notes')).toBe('')
  })

  it('fills amplitude_unit per cycle test and leaves tremor/rom cells blank on cycle rows', () => {
    const get = (row: string[], col: (typeof SUMMARY_COLUMNS)[number]) =>
      row[SUMMARY_COLUMNS.indexOf(col)]
    const tap = buildSummaryRow(subject, makeResult(false), '', '')
    expect(get(tap, 'amplitude_unit')).toBe('hand')
    expect(get(tap, 'tremor_dominant_freq_hz')).toBe('')
    expect(get(tap, 'total_active_rom_deg')).toBe('')

    const { frames } = makePronosupFrames({ freqHz: 1, durationMs: 4000 })
    const pronosup = buildSummaryRow(
      subject,
      {
        ...makeFamilyResult('pronation_supination', computePronosupMetrics(frames)),
        report: buildSessionReport({
          test: 'pronation_supination',
          hand: 'right',
          startedAt: '2026-07-02T10:15:02.000Z',
          durationMs: 4000,
          analysis: computePronosupMetrics(frames),
          frames,
        }),
      },
      '',
      '',
    )
    expect(get(pronosup, 'amplitude_unit')).toBe('deg')
    expect(Number(get(pronosup, 'amplitude_mean'))).toBeGreaterThan(60) // degrees, not hand units
    expect(get(pronosup, 'amplitude_mean_cm')).toBe('') // cmPerUnit is null
  })

  it('fills the tremor columns on tremor rows, everything else blank', () => {
    const get = (row: string[], col: (typeof SUMMARY_COLUMNS)[number]) =>
      row[SUMMARY_COLUMNS.indexOf(col)]
    const { frames } = makeTremorFrames({ freqHz: 5, ampCm: 0.8 })
    const row = buildSummaryRow(
      subject,
      makeFamilyResult('tremor_postural', computeTremorMetrics(frames)),
      '',
      '',
    )
    expect(Number(get(row, 'tremor_dominant_freq_hz'))).toBeCloseTo(5, 0)
    expect(Number(get(row, 'tremor_rms_amp_cm'))).toBeCloseTo(0.8 / Math.SQRT2, 1)
    expect(Number(get(row, 'tremor_index_pct'))).toBeGreaterThan(60)
    expect(get(row, 'amplitude_unit')).toBe('')
    expect(get(row, 'count')).toBe('')
    expect(get(row, 'total_active_rom_deg')).toBe('')
  })

  it('fills the six rom columns on rom rows, everything else blank', () => {
    const get = (row: string[], col: (typeof SUMMARY_COLUMNS)[number]) =>
      row[SUMMARY_COLUMNS.indexOf(col)]
    const { frames } = makeRomSweepFrames()
    const row = buildSummaryRow(
      subject,
      makeFamilyResult('rom_test', computeRomMetrics(frames)),
      '',
      '',
    )
    expect(Number(get(row, 'total_active_rom_deg'))).toBeGreaterThan(800)
    expect(Number(get(row, 'rom_index_deg'))).toBeGreaterThan(180)
    expect(Number(get(row, 'rom_thumb_deg'))).toBeGreaterThan(80)
    expect(get(row, 'amplitude_unit')).toBe('')
    expect(get(row, 'count')).toBe('')
    expect(get(row, 'tremor_dominant_freq_hz')).toBe('')
  })
})
