// React wrappers around the imperative uPlot cores. Frame data NEVER flows
// through props/state — the record/monitor screens push samples through an
// imperative handle from their own frame subscriptions. Charts are recreated
// when the resolved theme changes so they re-read the chart tokens.

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { TrendLine, TrendPoint } from '../../analysis/trends'
import type { CycleEvent, Series } from '../../types'
import { cn } from '../lib/cn'
import { useTheme } from '../theme'
import {
  createEventChart,
  createOverlayEventChart,
  createOverlaySignalChart,
  createSignalChart,
  createStreamChart,
  createTrendChart,
  type StreamChartCore,
} from './uplotCore'

const MS_PER_DAY = 86_400_000

const panelClass = 'rounded-xl border bg-surface px-2 pb-1 pt-3 min-h-[120px]'

export interface StreamChartHandle {
  push(tMs: number, v: number): void
}

export function StreamChart({
  ref,
  yRange,
  windowMs,
  height,
  className,
}: {
  ref: Ref<StreamChartHandle>
  yRange: readonly [number, number]
  windowMs: number
  height?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<StreamChartCore | null>(null)
  const { resolved } = useTheme()

  useImperativeHandle(ref, () => ({ push: (t, v) => chart.current?.push(t, v) }), [])

  const y0 = yRange[0]
  const y1 = yRange[1]
  useEffect(() => {
    const c = createStreamChart(host.current!, { yRange: [y0, y1], windowMs, height })
    chart.current = c
    return () => {
      chart.current = null
      c.destroy()
    }
  }, [resolved, y0, y1, windowMs, height])

  return <div ref={host} className={cn(panelClass, className)} />
}

export function SignalChart({
  series,
  events,
  yLabel,
  height,
  className,
}: {
  series: Series
  events: CycleEvent[]
  yLabel: string
  height?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  useEffect(() => {
    const c = createSignalChart(host.current!, series, events, yLabel, height)
    return () => c.destroy()
  }, [resolved, series, events, yLabel, height])
  return <div ref={host} className={cn(panelClass, className)} />
}

export function EventChart({
  values,
  yLabel,
  trend,
  height,
  className,
}: {
  values: number[]
  yLabel: string
  trend?: boolean
  height?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  useEffect(() => {
    const c = createEventChart(host.current!, values, yLabel, { trend, height })
    return () => c.destroy()
  }, [resolved, values, yLabel, trend, height])
  return <div ref={host} className={cn(panelClass, className)} />
}

/** Longitudinal trend chart. `points`/`line` are in the days-relative units
 *  buildTrend() returns (tDays since the first point); this wrapper converts
 *  to the epoch-seconds x domain createTrendChart expects. */
export function TrendChart({
  points,
  line,
  yLabel,
  height,
  className,
}: {
  points: TrendPoint[]
  line: TrendLine | null
  yLabel: string
  height?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  useEffect(() => {
    const t0Sec = points.length > 0 ? Date.parse(points[0]!.startedAt) / 1000 : 0
    const chartPoints = points.map((p) => ({
      x: t0Sec + (p.tDays * MS_PER_DAY) / 1000,
      y: p.value,
    }))
    const slopePerSec = line ? line.slopePerDay / (MS_PER_DAY / 1000) : 0
    const chartLine = line ? { m: slopePerSec, b: line.intercept - slopePerSec * t0Sec } : null
    const c = createTrendChart(host.current!, chartPoints, chartLine, yLabel, { height })
    return () => c.destroy()
  }, [resolved, points, line, yLabel, height])
  return <div ref={host} className={cn(panelClass, className)} />
}

/** Two recordings' signals overlaid, t=0-rebased (a = left/orange, b =
 *  right/blue — the fixed bilateral convention). */
export function OverlaySignalChart({
  a,
  b,
  yLabel,
  height,
  className,
}: {
  a: Series
  b: Series
  yLabel: string
  height?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  useEffect(() => {
    const c = createOverlaySignalChart(host.current!, a, b, yLabel, { height })
    return () => c.destroy()
  }, [resolved, a, b, yLabel, height])
  return <div ref={host} className={cn(panelClass, className)} />
}

/** Two recordings' per-event values overlaid by event index. */
export function OverlayEventChart({
  a,
  b,
  yLabel,
  height,
  className,
}: {
  a: number[]
  b: number[]
  yLabel: string
  height?: number
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const { resolved } = useTheme()
  useEffect(() => {
    const c = createOverlayEventChart(host.current!, a, b, yLabel, { height })
    return () => c.destroy()
  }, [resolved, a, b, yLabel, height])
  return <div ref={host} className={cn(panelClass, className)} />
}
