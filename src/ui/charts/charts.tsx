// React wrappers around the imperative uPlot cores. Frame data NEVER flows
// through props/state — the record/monitor screens push samples through an
// imperative handle from their own frame subscriptions. Charts are recreated
// when the resolved theme changes so they re-read the chart tokens.

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { CycleEvent, Series } from '../../types'
import { cn } from '../lib/cn'
import { useTheme } from '../theme'
import {
  createEventChart,
  createSignalChart,
  createStreamChart,
  type StreamChartCore,
} from './uplotCore'

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
