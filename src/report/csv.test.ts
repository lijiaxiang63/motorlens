import { describe, expect, it } from 'vitest'
import { computeTapMetrics } from '../metrics/taps'
import { makeTapFrames } from '../replay/synthetic'
import type { StoredResult, Subject } from '../store/subjects'
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

  it('locks the 39-column set with result_notes appended last', () => {
    expect(SUMMARY_COLUMNS.length).toBe(39)
    expect(SUMMARY_COLUMNS[38]).toBe('result_notes')
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
})
