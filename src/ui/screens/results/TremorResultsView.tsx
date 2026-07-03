// Tremor-family results layout: metric cards with delta chips and
// reference-cue flags, a low-confidence banner when no discernible tremor
// peak exists, the Welch PSD with the shaded 3–12 Hz band, and the
// dominant-axis displacement trace. Shared machinery lives in
// useResultSession / ResultHeader like the other family views.

import {
  deltaTone,
  formatDelta,
  metricByKeyFor,
  metricValueOf,
  type MetricKey,
} from '../../../analysis/metricCatalog'
import { evaluateThreshold } from '../../../analysis/thresholds'
import { TREMOR_BAND_HZ } from '../../../config'
import { isLowConfidenceTremor } from '../../../metrics/tremor'
import { PsdChart, SignalChart } from '../../charts/charts'
import { MetricCard, type MetricDelta } from '../../components/MetricCard'
import { fmt } from '../../format'
import type { TremorResultProps } from '../../nav'
import { ResultHeader, ResultNotesCard, SectionTitle } from './ResultHeader'
import { useResultSession } from './useResultSession'

export function TremorResultsView({ result: r }: { result: TremorResultProps }) {
  const { def, analysis } = r
  const m = analysis.metrics
  const session = useResultSession(r)
  const { deltas, thresholds } = session

  function chipFor(key: MetricKey): MetricDelta | undefined {
    const delta = deltas?.[key]
    if (delta == null) return undefined
    const chipDef = metricByKeyFor(def.id, key)
    const tone = deltaTone(chipDef, delta)
    if (!tone) return undefined
    return { text: formatDelta(chipDef, delta), tone }
  }

  function flaggedTone(key: MetricKey): 'warn' | undefined {
    const value = metricValueOf(metricByKeyFor(def.id, key), m)
    return evaluateThreshold(thresholds[key], value) ? 'warn' : undefined
  }

  const lowConfidence = isLowConfidenceTremor(m)
  const axisSub = m.axisSharePct
    ? `axes: ${m.axisSharePct.x.toFixed(0)}% x · ${m.axisSharePct.y.toFixed(0)}% y`
    : undefined

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <ResultHeader
        result={r}
        report={session.report}
        notes={session.notes}
        resultId={session.resultId}
        savedChip={session.savedChip}
      />

      {lowConfidence && (
        <div className="mb-4 rounded-xl border bg-surface-2 px-3.5 py-2.5 text-[13.5px] text-muted-foreground">
          No discernible tremor peak in the 3–12 Hz band — the frequency and
          amplitude readings below carry low confidence.
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <MetricCard
          label="Tremor frequency"
          value={fmt(m.dominantFreqHz, 1, ' Hz')}
          sub="dominant, 3–12 Hz band"
          tone={flaggedTone('tremorDominantFreqHz') ?? (lowConfidence ? undefined : 'accent')}
          delta={chipFor('tremorDominantFreqHz')}
        />
        <MetricCard
          label="Amplitude (RMS)"
          value={fmt(m.rmsAmplitudeCm, 2, ' cm')}
          sub="in-band, both axes"
          tone={flaggedTone('tremorRmsAmpCm')}
          delta={chipFor('tremorRmsAmpCm')}
        />
        <MetricCard
          label="Amplitude (peak)"
          value={fmt(m.peakAmplitudeCm, 2, ' cm')}
          tone={flaggedTone('tremorPeakAmpCm')}
          delta={chipFor('tremorPeakAmpCm')}
        />
        <MetricCard
          label="Tremor index"
          value={fmt(m.tremorIndexPct, 0, '%')}
          sub="of 0.5–15 Hz power in band"
          tone={flaggedTone('tremorIndexPct')}
          delta={chipFor('tremorIndexPct')}
        />
        <MetricCard
          label="Band power"
          value={fmt(m.bandPowerCm2, 3, ' cm²')}
          sub={axisSub}
          tone={flaggedTone('tremorBandPower')}
          delta={chipFor('tremorBandPower')}
        />
      </div>

      <SectionTitle>Power spectrum</SectionTitle>
      <PsdChart psd={analysis.psd} bandHz={TREMOR_BAND_HZ} yLabel="power (cm²/Hz)" />

      <SectionTitle>Displacement</SectionTitle>
      <SignalChart series={analysis.signal} events={[]} yLabel="displacement (cm)" />

      <ResultNotesCard
        notes={session.notes}
        resultId={session.resultId}
        onChange={session.handleNotesChange}
        onBlur={session.flushNotes}
      />
    </div>
  )
}
