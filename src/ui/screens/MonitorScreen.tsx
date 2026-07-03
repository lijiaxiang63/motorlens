// Joint Monitor: live flexion angles for all 15 finger joints with ROM and
// peak angular velocity accumulators, plus a streaming chart for the
// selected joint. Untimed — runs until the user leaves.
//
// The joint table re-renders from React state at a 200 ms cadence; the chart
// is fed imperatively from the frame subscription (never through props).

import { RotateCcw, FileDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { JointTracker } from '../../metrics/angles'
import { buildSessionReport, downloadReport } from '../../report/export'
import type { Hand, JointId, JointSummaries, LandmarkFrame } from '../../types'
import { StreamChart, type StreamChartHandle } from '../charts/charts'
import { Button } from '../components/ui/button'
import { JointTable } from '../components/JointTable'
import { PageHeader } from '../components/PageHeader'
import { fmt } from '../format'
import { useFrameSubscription } from '../hooks/useFrameSubscription'
import { useInterval } from '../hooks/useInterval'
import { useNav } from '../nav'
import { PreviewPanel } from '../PreviewPanel'

const FRAME_BUFFER_MS = 30_000

export function MonitorScreen() {
  const { source, navigate } = useNav()
  const trackerRef = useRef<JointTracker | null>(null)
  trackerRef.current ??= new JointTracker()
  const tracker = trackerRef.current

  const startedAtRef = useRef(new Date().toISOString())
  const framesRef = useRef<LandmarkFrame[]>([])
  const lastHandRef = useRef<Hand>('right')
  const chartRef = useRef<StreamChartHandle>(null)
  const [selected, setSelected] = useState<JointId>('index_pip')
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [summaries, setSummaries] = useState<JointSummaries>(() => tracker.summaries())

  useFrameSubscription(source, (f) => {
    tracker.push(f)
    if (f.handedness) lastHandRef.current = f.handedness
    framesRef.current.push(f)
    const cutoff = f.t - FRAME_BUFFER_MS
    if (framesRef.current.length > 4 && framesRef.current[0]!.t < cutoff) {
      framesRef.current = framesRef.current.filter((fr) => fr.t >= cutoff)
    }
    if (f.world) {
      const s = tracker.series(selectedRef.current)
      if (s.t.length > 0) chartRef.current?.push(s.t[s.t.length - 1]!, s.v[s.v.length - 1]!)
    }
  })

  useInterval(() => setSummaries(tracker.summaries()), 200)

  // Replay the selected joint's history whenever the chart is recreated
  // (joint change remounts it via key; theme switches recreate it too).
  useEffect(() => {
    const s = tracker.series(selected)
    for (let i = 0; i < s.t.length; i++) chartRef.current?.push(s.t[i]!, s.v[i]!)
  }, [tracker, selected])

  function exportSession() {
    const frames = framesRef.current
    const span = frames.length >= 2 ? frames[frames.length - 1]!.t - frames[0]!.t : 0
    void downloadReport(
      buildSessionReport({
        test: 'joint_monitor',
        hand: lastHandRef.current,
        startedAt: startedAtRef.current,
        durationMs: span,
        analysis: null,
        jointSummaries: tracker.summaries(),
        frames,
      }),
    )
  }

  const j = summaries[selected]

  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-12 pt-6">
      <PageHeader
        title="Joint Monitor"
        description="Flexion per joint · click a cell to chart it"
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                tracker.reset()
                setSummaries(tracker.summaries())
              }}
            >
              <RotateCcw /> Reset ROM
            </Button>
            <Button variant="ghost" onClick={exportSession}>
              <FileDown /> Export JSON
            </Button>
            <Button variant="primary" onClick={() => navigate({ name: 'home' })}>
              Home
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-4 max-[900px]:grid-cols-1">
        <PreviewPanel className="sticky top-3 max-[900px]:static" />
        <JointTable summaries={summaries} selected={selected} onSelect={setSelected} />
      </div>

      <h3 className="mb-1 mt-4 text-sm font-semibold uppercase tracking-[0.8px] text-muted-foreground">
        {selected.replace('_', ' ').toUpperCase()} — flexion (°)
      </h3>
      <p className="mb-2 text-xs text-muted-foreground tabular-nums">
        min {fmt(j.minDeg, 0, '°')} · max {fmt(j.maxDeg, 0, '°')} · ROM {fmt(j.romDeg, 0, '°')} ·
        peak ω {fmt(j.peakAngVelDegS, 0, '°/s')}
      </p>
      <StreamChart
        key={selected}
        ref={chartRef}
        yRange={[0, 130]}
        windowMs={10_000}
        height={220}
      />
    </div>
  )
}
