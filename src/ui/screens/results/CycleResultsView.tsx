// Cycle-family results layout: the 12 metric cards, signal chart with
// closure markers, per-event amplitude/interval charts, and notes. All
// family-agnostic machinery (report/auto-save/deltas/thresholds) lives in
// useResultSession; header/warnings/notes chrome in ResultHeader.

import { useMemo } from 'react'
import {
  deltaTone,
  formatDelta,
  metricByKeyFor,
  type MetricKey,
} from '../../../analysis/metricCatalog'
import { evaluateThreshold } from '../../../analysis/thresholds'
import { SignalChart, EventChart } from '../../charts/charts'
import { MetricCard, type MetricDelta } from '../../components/MetricCard'
import { fmt } from '../../format'
import type { ResultProps } from '../../nav'
import { ResultHeader, ResultNotesCard, SectionTitle } from './ResultHeader'
import { useResultSession } from './useResultSession'

export function CycleResultsView({ result: r }: { result: ResultProps }) {
  const { def, analysis } = r
  const m = analysis.metrics
  const session = useResultSession(r)
  const { deltas, thresholds } = session

  function chipFor(key: MetricKey): MetricDelta | undefined {
    const delta = deltas?.[key]
    if (delta == null) return undefined
    // Unit-correct def for this test (degree tests format chips in °).
    const chipDef = metricByKeyFor(def.id, key)
    const tone = deltaTone(chipDef, delta)
    if (!tone) return undefined
    return { text: formatDelta(chipDef, delta), tone }
  }

  function flaggedTone(key: MetricKey): 'warn' | undefined {
    const value = metricByKeyFor(def.id, key).getter(m)
    return evaluateThreshold(thresholds[key], value) ? 'warn' : undefined
  }

  const extraWarnings =
    m.count < 4
      ? ['Very few events detected — decrement and rhythm metrics need more repetitions.']
      : []

  // --- metric cards ---
  const noun = def.eventNoun[1]
  // Degree tests format amplitudes/velocities in ° (matching CYCLE_CATALOG_DEG);
  // their cm subtexts vanish naturally because cmPerUnit is null.
  const deg = def.signalKind === 'degrees'
  const ampDigits = deg ? 0 : 2
  const ampUnit = deg ? '°' : ''
  const velDigits = deg ? 0 : 1
  const velUnit = deg ? ' °/s' : ' u/s'
  const cmSub = (units: number | null, digits = 1) =>
    units !== null && m.cmPerUnit !== null
      ? `≈ ${(units * m.cmPerUnit).toFixed(digits)} cm`
      : undefined
  const cmVelSub = (units: number | null) =>
    units !== null && m.cmPerUnit !== null
      ? `≈ ${(units * m.cmPerUnit).toFixed(0)} cm/s`
      : undefined

  const itis = useMemo(() => {
    const out: number[] = []
    for (let i = 1; i < analysis.events.length; i++) {
      const a = analysis.events[i - 1]!
      const b = analysis.events[i]!
      if (a.segment === b.segment) out.push(b.tMs - a.tMs)
    }
    return out
  }, [analysis.events])

  const amplitudes = useMemo(
    () => analysis.events.map((e) => e.closingAmplitude),
    [analysis.events],
  )

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <ResultHeader
        result={r}
        report={session.report}
        notes={session.notes}
        resultId={session.resultId}
        savedChip={session.savedChip}
        extraWarnings={extraWarnings}
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <MetricCard
          label={noun}
          value={String(m.count)}
          sub={`in ${(session.durationMs / 1000).toFixed(session.durationMs % 1000 === 0 ? 0 : 1)} s`}
          tone={flaggedTone('count') ?? 'accent'}
          delta={chipFor('count')}
        />
        <MetricCard
          label="Frequency"
          value={fmt(m.frequencyHz, 2, ' Hz')}
          tone={flaggedTone('frequencyHz')}
          delta={chipFor('frequencyHz')}
        />
        <MetricCard
          label="Amplitude (mean)"
          value={fmt(m.amplitudeMean, ampDigits, ampUnit)}
          sub={cmSub(m.amplitudeMean)}
          tone={flaggedTone('amplitudeMean')}
          delta={chipFor('amplitudeMean')}
        />
        <MetricCard
          label="Amplitude (max)"
          value={fmt(m.amplitudeMax, ampDigits, ampUnit)}
          sub={cmSub(m.amplitudeMax)}
          tone={flaggedTone('amplitudeMax')}
          delta={chipFor('amplitudeMax')}
        />
        <MetricCard
          label={`${def.closingLabel} (mean)`}
          value={fmt(m.closingVelMean, velDigits, velUnit)}
          sub={cmVelSub(m.closingVelMean)}
          tone={flaggedTone('closingVelMean')}
          delta={chipFor('closingVelMean')}
        />
        <MetricCard
          label={`${def.closingLabel} (peak)`}
          value={fmt(m.closingVelPeak, velDigits, velUnit)}
          sub={cmVelSub(m.closingVelPeak)}
          tone={flaggedTone('closingVelPeak')}
          delta={chipFor('closingVelPeak')}
        />
        <MetricCard
          label={`${def.openingLabel} (mean)`}
          value={fmt(m.openingVelMean, velDigits, velUnit)}
          sub={cmVelSub(m.openingVelMean)}
          tone={flaggedTone('openingVelMean')}
          delta={chipFor('openingVelMean')}
        />
        <MetricCard
          label="Amplitude decrement"
          value={fmt(m.amplitudeDecrement.regressionPct, 0, '%')}
          sub={
            m.amplitudeDecrement.thirdsPct !== null
              ? `thirds: ${fmt(m.amplitudeDecrement.thirdsPct, 0, '%')}`
              : undefined
          }
          tone={flaggedTone('ampDecrementPct')}
          delta={chipFor('ampDecrementPct')}
        />
        <MetricCard
          label="Velocity decrement"
          value={fmt(m.velocityDecrement.regressionPct, 0, '%')}
          tone={flaggedTone('velDecrementPct')}
          delta={chipFor('velDecrementPct')}
        />
        <MetricCard
          label="Rhythm variability"
          value={fmt(m.rhythm.itiCvPct, 0, '%')}
          sub="CV of intervals"
          tone={flaggedTone('itiCvPct')}
          delta={chipFor('itiCvPct')}
        />
        <MetricCard
          label="Hesitations"
          value={String(m.rhythm.hesitationCount)}
          sub={
            m.rhythm.longestPauseMs !== null
              ? `longest pause ${fmt(m.rhythm.longestPauseMs / 1000, 2, ' s')}`
              : undefined
          }
          tone={flaggedTone('hesitationCount')}
          delta={chipFor('hesitationCount')}
        />
        <MetricCard
          label="Mean interval"
          value={fmt(m.rhythm.itiMeanMs, 0, ' ms')}
          tone={flaggedTone('itiMeanMs')}
          delta={chipFor('itiMeanMs')}
        />
      </div>

      <SectionTitle>Signal</SectionTitle>
      <SignalChart series={analysis.signal} events={analysis.events} yLabel={def.signalLabel} />

      <div className="grid grid-cols-2 gap-4 min-w-0-children max-[900px]:grid-cols-1">
        <div>
          <SectionTitle>Amplitude per event</SectionTitle>
          <EventChart values={amplitudes} yLabel={deg ? 'amplitude (°)' : 'amplitude (hand units)'} trend />
        </div>
        <div>
          <SectionTitle>Interval per event</SectionTitle>
          <EventChart values={itis} yLabel="interval (ms)" />
        </div>
      </div>

      <ResultNotesCard
        notes={session.notes}
        resultId={session.resultId}
        onChange={session.handleNotesChange}
        onBlur={session.flushNotes}
      />
    </div>
  )
}
