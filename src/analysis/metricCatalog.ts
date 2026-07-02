// Pure table of the ~12 headline cycle-test metrics, shared by every
// analytics feature (asymmetry, trends, comparison) and, later, PDF
// reporting — direction/format/getter logic exists exactly once here.

import { fmt } from '../ui/format'
import type { CycleTestMetrics, SessionReport } from '../types'

export type MetricKey =
  | 'count'
  | 'frequencyHz'
  | 'amplitudeMean'
  | 'amplitudeMax'
  | 'closingVelMean'
  | 'closingVelPeak'
  | 'openingVelMean'
  | 'ampDecrementPct'
  | 'velDecrementPct'
  | 'itiCvPct'
  | 'hesitationCount'
  | 'itiMeanMs'

export type MetricDirection = 'higher-better' | 'lower-better' | 'neutral'

export interface MetricDef {
  key: MetricKey
  label: string
  digits: number
  /** Passed straight to fmt()'s `unit` param — includes a leading space
   *  where the number reads better with one (' Hz', ' u/s', ' ms'). */
  unit: string
  direction: MetricDirection
  /** 'ratio' metrics use signed AI% = 200·(R−L)/(R+L); 'points' metrics
   *  (already percentages, or counts that can be ≈0) use a raw R−L
   *  difference instead — AI% is unstable near a zero denominator. */
  asymmetry: 'ratio' | 'points'
  /** Member of the subject-hub sparkline grid (a curated subset, not all 12). */
  spark: boolean
  getter(m: CycleTestMetrics): number | null
}

export const METRIC_CATALOG: readonly MetricDef[] = [
  {
    key: 'count',
    label: 'Events',
    digits: 0,
    unit: '',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: false,
    getter: (m) => m.count,
  },
  {
    key: 'frequencyHz',
    label: 'Frequency',
    digits: 2,
    unit: ' Hz',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: true,
    getter: (m) => m.frequencyHz,
  },
  {
    key: 'amplitudeMean',
    label: 'Amplitude (mean)',
    digits: 2,
    unit: '',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: true,
    getter: (m) => m.amplitudeMean,
  },
  {
    key: 'amplitudeMax',
    label: 'Amplitude (max)',
    digits: 2,
    unit: '',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: false,
    getter: (m) => m.amplitudeMax,
  },
  {
    key: 'closingVelMean',
    label: 'Closing speed (mean)',
    digits: 1,
    unit: ' u/s',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: false,
    getter: (m) => m.closingVelMean,
  },
  {
    key: 'closingVelPeak',
    label: 'Closing speed (peak)',
    digits: 1,
    unit: ' u/s',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: false,
    getter: (m) => m.closingVelPeak,
  },
  {
    key: 'openingVelMean',
    label: 'Opening speed (mean)',
    digits: 1,
    unit: ' u/s',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: false,
    getter: (m) => m.openingVelMean,
  },
  {
    key: 'ampDecrementPct',
    label: 'Amplitude decrement',
    digits: 0,
    unit: '%',
    direction: 'lower-better',
    asymmetry: 'points',
    spark: true,
    getter: (m) => m.amplitudeDecrement.regressionPct,
  },
  {
    key: 'velDecrementPct',
    label: 'Velocity decrement',
    digits: 0,
    unit: '%',
    direction: 'lower-better',
    asymmetry: 'points',
    spark: false,
    getter: (m) => m.velocityDecrement.regressionPct,
  },
  {
    key: 'itiCvPct',
    label: 'Rhythm variability',
    digits: 0,
    unit: '%',
    direction: 'lower-better',
    asymmetry: 'points',
    spark: true,
    getter: (m) => m.rhythm.itiCvPct,
  },
  {
    key: 'hesitationCount',
    label: 'Hesitations',
    digits: 0,
    unit: '',
    direction: 'lower-better',
    // Counts are frequently 0 on both sides — AI% would explode/read noisy
    // near a zero denominator, so hesitations compare as a raw point diff.
    asymmetry: 'points',
    spark: false,
    getter: (m) => m.rhythm.hesitationCount,
  },
  {
    key: 'itiMeanMs',
    label: 'Mean interval',
    digits: 0,
    unit: ' ms',
    // The inverse of frequency — flagging it as better/worse would
    // double-count the same signal frequencyHz already colors.
    direction: 'neutral',
    asymmetry: 'ratio',
    spark: false,
    getter: (m) => m.rhythm.itiMeanMs,
  },
] as const

export function metricByKey(key: MetricKey): MetricDef {
  const def = METRIC_CATALOG.find((d) => d.key === key)
  if (!def) throw new Error(`Unknown metric key: ${key}`)
  return def
}

/** Narrows a report's metrics to CycleTestMetrics, or null for JointSummaries
 *  (joint_monitor) reports — the single guard every analytics consumer routes
 *  through, so a stray joint result can never reach a catalog getter. Mirrors
 *  csv.ts's isCycleMetrics check. */
export function cycleMetricsOf(report: SessionReport): CycleTestMetrics | null {
  const m = report.metrics as CycleTestMetrics
  return typeof m?.count === 'number' ? m : null
}

export function formatMetric(def: MetricDef, v: number | null): string {
  return fmt(v, def.digits, def.unit)
}

/** Signed delta with an explicit +/− sign (fmt() only signs negatives). */
export function formatDelta(def: MetricDef, delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—'
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±'
  return sign + Math.abs(delta).toFixed(def.digits) + def.unit
}
