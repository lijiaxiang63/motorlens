// Batch-export summary CSV: one row per stored result. Pure and DOM-free so
// the column layout is locked down by unit tests. Excel-friendly output:
// UTF-8 BOM, CRLF line endings, RFC 4180 quoting.

import { familyOfTest, testDefById } from '../protocol/definitions'
import type { Subject, StoredResult } from '../store/subjects'
import type { CycleTestMetrics, RomMetrics, TremorMetrics } from '../types'

export const SUMMARY_COLUMNS = [
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
  'result_notes',
  // Phase 4 append (one deliberate update, locked by csv.test.ts):
  // 'hand' | 'deg' for cycle tests (pron-sup amplitudes are degrees), ''
  // for other families; then the tremor and ROM metric columns — blank on
  // rows of any other family, mirroring the cycle columns' behavior.
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
] as const

/** '' for null/undefined; numbers rounded to 4 decimals (trailing zeros trimmed
 *  by Number()); everything else stringified. */
function cell(x: unknown): string {
  if (x === null || x === undefined) return ''
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return ''
    return String(Number(x.toFixed(4)))
  }
  return String(x)
}

/** videoFile/reportFile are ZIP-relative paths ('' when absent). */
export function buildSummaryRow(
  subject: Subject,
  result: StoredResult,
  videoFile: string,
  reportFile: string,
): string[] {
  const rep = result.report
  // Family discrimination by test id — each family fills its own metric
  // columns and leaves the others blank (joint_monitor fills none).
  const family = familyOfTest(result.testId)
  const def = testDefById(result.testId)
  const m = family === 'cycle' ? (rep.metrics as CycleTestMetrics) : null
  const tremor = family === 'tremor' ? (rep.metrics as TremorMetrics) : null
  const rom = family === 'rom' ? (rep.metrics as RomMetrics) : null
  const amplitudeUnit =
    def?.family === 'cycle' ? (def.signalKind === 'degrees' ? 'deg' : 'hand') : ''
  const q = rep.quality
  return [
    cell(subject.code),
    cell(subject.name),
    cell(subject.sex),
    cell(subject.birthYear),
    cell(subject.dominantHand),
    cell(subject.diagnosis),
    cell(subject.notes),
    cell(result.testId),
    cell(result.hand),
    cell(result.source),
    cell(result.startedAt),
    cell(rep.durationMs),
    cell(m?.count),
    cell(m?.frequencyHz),
    cell(m?.amplitudeMean),
    cell(m?.amplitudeMax),
    cell(m?.amplitudeMeanCm),
    cell(m?.closingVelMean),
    cell(m?.closingVelPeak),
    cell(m?.closingVelPeakCmS),
    cell(m?.openingVelMean),
    cell(m?.openingVelPeak),
    cell(m?.amplitudeDecrement.regressionPct),
    cell(m?.amplitudeDecrement.thirdsPct),
    cell(m?.velocityDecrement.regressionPct),
    cell(m?.velocityDecrement.thirdsPct),
    cell(m?.rhythm.itiMeanMs),
    cell(m?.rhythm.itiCvPct),
    cell(m?.rhythm.hesitationCount),
    cell(m?.rhythm.longestPauseMs),
    cell(m?.rhythm.droppedIntervals),
    cell(m?.cmPerUnit),
    cell(q?.meanFps),
    cell(q?.detectionRate),
    cell(q?.handScaleCvPct),
    result.videoKey ? 'yes' : 'no',
    cell(videoFile),
    cell(reportFile),
    cell(rep.notes),
    amplitudeUnit,
    cell(tremor?.dominantFreqHz),
    cell(tremor?.rmsAmplitudeCm),
    cell(tremor?.tremorIndexPct),
    cell(rom?.totalActiveRomDeg),
    cell(rom?.perFinger.thumb),
    cell(rom?.perFinger.index),
    cell(rom?.perFinger.middle),
    cell(rom?.perFinger.ring),
    cell(rom?.perFinger.pinky),
  ]
}

function escapeField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildSummaryCsv(rows: string[][]): string {
  const lines = [SUMMARY_COLUMNS as readonly string[], ...rows].map((r) =>
    r.map(escapeField).join(','),
  )
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
