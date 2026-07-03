// ROM-family results layout: total + per-finger ROM cards with delta chips
// and reference-cue flags, per-finger bars (plain HTML — print-safe), the
// 15-joint min/max/ROM/peak-velocity table, and a per-joint flexion trace
// with a joint selector. Shared machinery lives in useResultSession /
// ResultHeader like the cycle view.

import { useState } from 'react'
import {
  deltaTone,
  formatDelta,
  metricByKeyFor,
  metricValueOf,
  type MetricKey,
} from '../../../analysis/metricCatalog'
import { evaluateThreshold } from '../../../analysis/thresholds'
import { JOINT_IDS } from '../../../metrics/angles'
import { FINGER_JOINTS } from '../../../metrics/rom'
import type { Finger, JointId } from '../../../types'
import { SignalChart } from '../../charts/charts'
import { MetricCard, type MetricDelta } from '../../components/MetricCard'
import { Select } from '../../components/ui/field'
import { fmt } from '../../format'
import type { RomResultProps } from '../../nav'
import { ResultHeader, ResultNotesCard, SectionTitle } from './ResultHeader'
import { useResultSession } from './useResultSession'

const FINGERS = Object.keys(FINGER_JOINTS) as Finger[]
const FINGER_KEYS: Record<Finger, MetricKey> = {
  thumb: 'romThumbDeg',
  index: 'romIndexDeg',
  middle: 'romMiddleDeg',
  ring: 'romRingDeg',
  pinky: 'romPinkyDeg',
}

function jointLabel(id: JointId): string {
  return id.replace('_', ' ').toUpperCase()
}

export function RomResultsView({ result: r }: { result: RomResultProps }) {
  const { def, analysis } = r
  const m = analysis.metrics
  const session = useResultSession(r)
  const { deltas, thresholds } = session
  const [selectedJoint, setSelectedJoint] = useState<JointId>('index_pip')

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

  const maxFingerRom = Math.max(...FINGERS.map((f) => m.perFinger[f] ?? 0), 1e-9)

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <ResultHeader
        result={r}
        report={session.report}
        notes={session.notes}
        resultId={session.resultId}
        savedChip={session.savedChip}
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        <MetricCard
          label="Total active ROM"
          value={fmt(m.totalActiveRomDeg, 0, '°')}
          sub={`in ${(session.durationMs / 1000).toFixed(session.durationMs % 1000 === 0 ? 0 : 1)} s`}
          tone={flaggedTone('romTotalDeg') ?? 'accent'}
          delta={chipFor('romTotalDeg')}
        />
        {FINGERS.map((finger) => (
          <MetricCard
            key={finger}
            label={`${finger[0]!.toUpperCase()}${finger.slice(1)} ROM`}
            value={fmt(m.perFinger[finger], 0, '°')}
            tone={flaggedTone(FINGER_KEYS[finger])}
            delta={chipFor(FINGER_KEYS[finger])}
          />
        ))}
      </div>

      <SectionTitle>ROM per finger</SectionTitle>
      <div className="flex flex-col divide-y divide-border rounded-xl border bg-surface px-3.5 py-1">
        {FINGERS.map((finger) => {
          const value = m.perFinger[finger]
          const pct = value !== null ? (value / maxFingerRom) * 100 : 0
          return (
            <div
              key={finger}
              className="grid grid-cols-[90px_1fr_70px] items-center gap-2 py-1.5 text-[12.5px]"
            >
              <span className="capitalize text-muted-foreground">{finger}</span>
              <div className="flex h-4 items-center">
                {value !== null && (
                  <div className="h-2 rounded-[4px] bg-chart-right" style={{ width: `${pct}%` }} />
                )}
              </div>
              <span className="text-right tabular-nums">{fmt(value, 0, '°')}</span>
            </div>
          )
        })}
      </div>

      <SectionTitle>Per-joint range</SectionTitle>
      <div className="overflow-hidden rounded-xl border bg-surface">
        <div className="grid grid-cols-[110px_1fr_1fr_1fr] gap-2 border-b bg-surface-2 px-3.5 py-2 text-xs font-medium text-muted-foreground">
          <span>Finger</span>
          <span>MCP / CMC</span>
          <span>PIP / MCP</span>
          <span>DIP / IP</span>
        </div>
        {FINGERS.map((finger) => (
          <div
            key={finger}
            className="grid grid-cols-[110px_1fr_1fr_1fr] items-center gap-2 border-b px-3.5 py-2 text-[13px] last:border-b-0"
          >
            <span className="capitalize text-muted-foreground">{finger}</span>
            {FINGER_JOINTS[finger].map((id) => {
              const j = m.joints[id]
              return (
                <span key={id} className="tabular-nums">
                  {fmt(j.romDeg, 0, '°')}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    {j.minDeg !== null && j.maxDeg !== null
                      ? `${j.minDeg.toFixed(0)}–${j.maxDeg.toFixed(0)}° · ω ${fmt(j.peakAngVelDegS, 0)}°/s`
                      : '—'}
                  </span>
                </span>
              )
            })}
          </div>
        ))}
      </div>

      <div className="mb-2 mt-5 flex items-center justify-between gap-3">
        <SectionTitle>Joint trace</SectionTitle>
        <Select
          className="w-44"
          value={selectedJoint}
          onChange={(e) => setSelectedJoint(e.target.value as JointId)}
          aria-label="Charted joint"
        >
          {JOINT_IDS.map((id) => (
            <option key={id} value={id}>
              {jointLabel(id)}
            </option>
          ))}
        </Select>
      </div>
      <SignalChart
        key={selectedJoint}
        series={analysis.jointSeries[selectedJoint]}
        events={[]}
        yLabel={`${jointLabel(selectedJoint)} flexion (°)`}
      />

      <ResultNotesCard
        notes={session.notes}
        resultId={session.resultId}
        onChange={session.handleNotesChange}
        onBlur={session.flushNotes}
      />
    </div>
  )
}
