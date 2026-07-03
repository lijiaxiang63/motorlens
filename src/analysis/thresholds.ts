// User-configurable reference cues (Phase 3): a metric can be flagged when it
// falls outside an operator-set warnBelow/warnAbove band. These are cues, not
// validated clinical norms — every report carries the disclaimer (see
// report/clinical.ts). Pure and DOM-free like the rest of src/analysis/.

import type { MetricInfo, MetricKey } from './metricCatalog'

export interface MetricThreshold {
  warnBelow?: number
  warnAbove?: number
}

export type ReferenceThresholds = Partial<Record<MetricKey, MetricThreshold>>

export type ThresholdFlag = 'below' | 'above' | null

/** Mirrors the on-screen cues ResultsScreen has always shown: amplitude
 *  decrement over 20%, and any hesitation at all. Shipped defaults, not
 *  norms — editable (and resettable to these) in Settings. */
export const DEFAULT_REFERENCE_THRESHOLDS: ReferenceThresholds = {
  ampDecrementPct: { warnAbove: 20 },
  hesitationCount: { warnAbove: 0 },
}

/** Strict `<`/`>` — matches today's hardcoded `> 20` / `> 0` cues (a value
 *  exactly at the threshold is not flagged). Null value (metric unavailable
 *  for this recording) never flags. */
export function evaluateThreshold(
  t: MetricThreshold | undefined,
  value: number | null,
): ThresholdFlag {
  if (!t || value == null || !Number.isFinite(value)) return null
  if (t.warnBelow !== undefined && value < t.warnBelow) return 'below'
  if (t.warnAbove !== undefined && value > t.warnAbove) return 'above'
  return null
}

/** Short human-readable cue text for a metric row, e.g. "> 20%", "< 3 Hz".
 *  When both bounds are set, only the warnAbove bound is shown (below/above
 *  cues co-existing on one metric is an edge case, not a common setup). */
export function formatThresholdCue(
  def: Pick<MetricInfo, 'unit'>,
  t: MetricThreshold,
): string | null {
  if (t.warnAbove !== undefined) return `> ${t.warnAbove}${def.unit}`
  if (t.warnBelow !== undefined) return `< ${t.warnBelow}${def.unit}`
  return null
}
