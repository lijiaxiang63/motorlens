// Pure metric catalogs shared by every analytics feature (asymmetry, trends,
// comparison, delta chips) and PDF reporting — direction/format/getter logic
// exists exactly once here. One catalog per test family; `catalogFor(testId)`
// is the per-test entry point, and `metricValue(def, report)` is the single
// family-checked place a getter meets a stored report's metrics.

import { familyOfTest, testDefById, type TestFamily } from '../protocol/definitions'
import { fmt } from '../ui/format'
import type { CycleTestMetrics, Finger, RomMetrics, SessionReport, TremorMetrics } from '../types'

export type CycleMetricKey =
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

export type TremorMetricKey =
  | 'tremorDominantFreqHz'
  | 'tremorRmsAmpCm'
  | 'tremorPeakAmpCm'
  | 'tremorIndexPct'
  | 'tremorBandPower'

export type RomMetricKey =
  | 'romTotalDeg'
  | 'romThumbDeg'
  | 'romIndexDeg'
  | 'romMiddleDeg'
  | 'romRingDeg'
  | 'romPinkyDeg'

/** Globally unique across families, so thresholds and trend-route payloads
 *  never collide. */
export type MetricKey = CycleMetricKey | RomMetricKey | TremorMetricKey

export type MetricDirection = 'higher-better' | 'lower-better' | 'neutral'

/** Getter-free metric descriptor — everything format/threshold/asymmetry
 *  helpers need without binding to a family's metrics type. */
export interface MetricInfo {
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
  /** Member of the subject-hub sparkline grid (a curated subset, not all). */
  spark: boolean
  /** Which test family this def's getter understands. */
  family: TestFamily
}

export interface MetricDef<M = CycleTestMetrics> extends MetricInfo {
  getter(m: M): number | null
}

/** Union of every family's def type. */
export type AnyMetricDef =
  | MetricDef<CycleTestMetrics>
  | MetricDef<RomMetrics>
  | MetricDef<TremorMetrics>

export const METRIC_CATALOG: readonly MetricDef<CycleTestMetrics>[] = [
  {
    key: 'count',
    label: 'Events',
    digits: 0,
    unit: '',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: false,
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
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
    family: 'cycle',
    getter: (m) => m.rhythm.itiMeanMs,
  },
] as const

/** Same keys/getters as METRIC_CATALOG with degree units — served by
 *  catalogFor() for cycle tests whose signalKind is 'degrees'
 *  (pronation-supination). Deliberately absent from metricByKey's global
 *  search and the Settings cue editor: the keys are shared, only display
 *  units differ. */
const DEG_OVERRIDES: Partial<Record<CycleMetricKey, { digits: number; unit: string }>> = {
  amplitudeMean: { digits: 0, unit: '°' },
  amplitudeMax: { digits: 0, unit: '°' },
  closingVelMean: { digits: 0, unit: ' °/s' },
  closingVelPeak: { digits: 0, unit: ' °/s' },
  openingVelMean: { digits: 0, unit: ' °/s' },
}

export const CYCLE_CATALOG_DEG: readonly MetricDef<CycleTestMetrics>[] = METRIC_CATALOG.map(
  (def) => ({ ...def, ...(DEG_OVERRIDES[def.key as CycleMetricKey] ?? {}) }),
)

const romFingerDef = (key: RomMetricKey, finger: Finger, label: string): MetricDef<RomMetrics> => ({
  key,
  label,
  digits: 0,
  unit: '°',
  direction: 'higher-better',
  asymmetry: 'ratio',
  spark: false,
  family: 'rom',
  getter: (m) => m.perFinger[finger],
})

export const ROM_CATALOG: readonly MetricDef<RomMetrics>[] = [
  {
    key: 'romTotalDeg',
    label: 'Total active ROM',
    digits: 0,
    unit: '°',
    direction: 'higher-better',
    asymmetry: 'ratio',
    spark: true,
    family: 'rom',
    getter: (m) => m.totalActiveRomDeg,
  },
  romFingerDef('romThumbDeg', 'thumb', 'Thumb ROM'),
  romFingerDef('romIndexDeg', 'index', 'Index ROM'),
  romFingerDef('romMiddleDeg', 'middle', 'Middle ROM'),
  romFingerDef('romRingDeg', 'ring', 'Ring ROM'),
  romFingerDef('romPinkyDeg', 'pinky', 'Pinky ROM'),
] as const

export const TREMOR_CATALOG: readonly MetricDef<TremorMetrics>[] = [
  {
    key: 'tremorDominantFreqHz',
    label: 'Tremor frequency',
    digits: 1,
    unit: ' Hz',
    // Frequency locates the tremor type (rest vs essential); neither
    // direction is "better".
    direction: 'neutral',
    asymmetry: 'ratio',
    spark: true,
    family: 'tremor',
    getter: (m) => m.dominantFreqHz,
  },
  {
    key: 'tremorRmsAmpCm',
    label: 'Tremor amplitude (RMS)',
    digits: 2,
    unit: ' cm',
    direction: 'lower-better',
    asymmetry: 'ratio',
    spark: true,
    family: 'tremor',
    getter: (m) => m.rmsAmplitudeCm,
  },
  {
    key: 'tremorPeakAmpCm',
    label: 'Tremor amplitude (peak)',
    digits: 2,
    unit: ' cm',
    direction: 'lower-better',
    asymmetry: 'ratio',
    spark: false,
    family: 'tremor',
    getter: (m) => m.peakAmplitudeCm,
  },
  {
    key: 'tremorIndexPct',
    label: 'Tremor index',
    digits: 0,
    unit: '%',
    direction: 'lower-better',
    // Already a bounded percentage that sits near zero for tremor-free
    // hands — a raw point difference reads better than an unstable AI%.
    asymmetry: 'points',
    spark: true,
    family: 'tremor',
    getter: (m) => m.tremorIndexPct,
  },
  {
    key: 'tremorBandPower',
    label: 'Band power (3\u201312 Hz)',
    digits: 3,
    unit: ' cm\u00b2',
    direction: 'lower-better',
    asymmetry: 'ratio',
    spark: false,
    family: 'tremor',
    getter: (m) => m.bandPowerCm2,
  },
] as const

/** Cue-editor / global-lookup groups: one canonical catalog per family
 *  (degree variants excluded — same keys). Extended as families land. */
export const CATALOG_GROUPS: readonly {
  family: TestFamily
  title: string
  defs: readonly AnyMetricDef[]
}[] = [
  { family: 'cycle', title: 'Cycle tests', defs: METRIC_CATALOG },
  { family: 'rom', title: 'Range of motion', defs: ROM_CATALOG },
  { family: 'tremor', title: 'Tremor', defs: TREMOR_CATALOG },
]

/** Curated headline subset across every family — the trend sparkline grid
 *  and the subject report's per-hand "latest" cards share this set. */
export const SPARK_KEYS: ReadonlySet<MetricKey> = new Set(
  CATALOG_GROUPS.flatMap((g) => g.defs.filter((d) => d.spark).map((d) => d.key)),
)

/** The metric vocabulary for one test id: unit-correct defs whose getters
 *  match that test's metrics shape. joint_monitor / unknown ids → []. */
export function catalogFor(testId: string): readonly AnyMetricDef[] {
  const def = testDefById(testId)
  if (!def) return []
  switch (def.family) {
    case 'cycle':
      return def.signalKind === 'degrees' ? CYCLE_CATALOG_DEG : METRIC_CATALOG
    case 'rom':
      return ROM_CATALOG
    case 'tremor':
      return TREMOR_CATALOG
  }
}

/** Global lookup across canonical catalogs (hand-unit cycle defs, later
 *  tremor/ROM) — keys are unique across families, so no test context is
 *  needed. Throws on unknown keys; old trend-route payloads and threshold
 *  records always resolve. */
export function metricByKey(key: MetricKey): AnyMetricDef {
  for (const group of CATALOG_GROUPS) {
    const def = group.defs.find((d) => d.key === key)
    if (def) return def
  }
  throw new Error(`Unknown metric key: ${key}`)
}

/** Unit-correct variant: prefers the test's own catalog (degree units for
 *  degree tests), falling back to the global lookup for keys outside it. */
export function metricByKeyFor(testId: string, key: MetricKey): AnyMetricDef {
  return catalogFor(testId).find((d) => d.key === key) ?? metricByKey(key)
}

/** Narrows a report's metrics to its family's shape, or null for
 *  joint_monitor / unknown ids. Discriminates on the test id's family,
 *  never on metric fields. Widens to a union as families land. */
export function reportMetrics(
  report: SessionReport,
): CycleTestMetrics | RomMetrics | TremorMetrics | null {
  switch (familyOfTest(report.test)) {
    case 'cycle':
      return report.metrics as CycleTestMetrics
    case 'rom':
      return report.metrics as RomMetrics
    case 'tremor':
      return report.metrics as TremorMetrics
    default:
      return null
  }
}

/** Narrows a report's metrics to CycleTestMetrics, or null for any other
 *  family (joint_monitor, tremor, ROM) — the guard every cycle-only consumer
 *  routes through, so a non-cycle result can never reach a cycle getter. */
export function cycleMetricsOf(report: SessionReport): CycleTestMetrics | null {
  return familyOfTest(report.test) === 'cycle' ? (report.metrics as CycleTestMetrics) : null
}

/** Applies a getter to a metrics object the CALLER guarantees matches the
 *  def's family — the one sanctioned cast. Prefer metricValue(), which
 *  checks the family itself. */
export function metricValueOf(def: AnyMetricDef, metrics: SessionReport['metrics']): number | null {
  return (def.getter as (m: SessionReport['metrics']) => number | null)(metrics)
}

/** The single family-checked place a catalog getter meets a report:
 *  null whenever the report's family doesn't match the def's. */
export function metricValue(def: AnyMetricDef, report: SessionReport): number | null {
  if (familyOfTest(report.test) !== def.family) return null
  return metricValueOf(def, report.metrics)
}

export function formatMetric(def: Pick<MetricInfo, 'digits' | 'unit'>, v: number | null): string {
  return fmt(v, def.digits, def.unit)
}

/** True when `delta` rounds to zero at `digits` decimal places — tiny
 *  floating-point noise (e.g. from timestamp jitter between two otherwise
 *  identical recordings) would otherwise print as a confusing "−0.00". */
export function roundsToZero(delta: number, digits: number): boolean {
  return Number(Math.abs(delta).toFixed(digits)) === 0
}

/** Signed delta with an explicit +/− sign (fmt() only signs negatives). */
export function formatDelta(
  def: Pick<MetricInfo, 'digits' | 'unit'>,
  delta: number | null,
): string {
  if (delta == null || !Number.isFinite(delta)) return '—'
  const zero = roundsToZero(delta, def.digits)
  const sign = zero ? '±' : delta > 0 ? '+' : '−'
  return sign + Math.abs(delta).toFixed(def.digits) + def.unit
}

/** Whether a delta reads as improvement, decline, or neither — accounts for
 *  the metric's direction (a "lower is better" metric going down is good).
 *  Null delta (no prior to compare to) yields null, not a chip. */
export function deltaTone(
  def: Pick<MetricInfo, 'digits' | 'direction'>,
  delta: number | null,
): 'good' | 'bad' | 'neutral' | null {
  if (delta == null || !Number.isFinite(delta)) return null
  if (def.direction === 'neutral' || roundsToZero(delta, def.digits)) return 'neutral'
  const improved = def.direction === 'higher-better' ? delta > 0 : delta < 0
  return improved ? 'good' : 'bad'
}
