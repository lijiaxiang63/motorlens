// Thin uPlot wrappers: one streaming chart for live recording, plus static
// result charts. All x axes are seconds. Ported unchanged from the vanilla
// ui/liveChart.ts except that colors come from the design-token layer
// (readChartPalette) instead of hardcoded hex — see ui/tokens.css.
//
// INVARIANT (do not simplify): uPlot mounts on a dedicated inner 100%-width
// div and resizes only when that div's width actually changes. Observing the
// padded panel directly, or resizing unconditionally, recreates the classic
// ResizeObserver ↔ setSize feedback loop inside grid tracks.

import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { MAX_GAP_MS } from '../../config'
import { linearRegression } from '../../signal/stats'
import type { CycleEvent, Series } from '../../types'

export interface ChartPalette {
  line: string
  marker: string
  trend: string
  axis: string
  grid: string
}

/** Read the current theme's chart tokens (call at chart creation; charts are
 *  recreated on theme switch so the values stay in sync). */
export function readChartPalette(): ChartPalette {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    line: v('--chart-line', '#3987e5'),
    marker: v('--chart-marker', '#e66767'),
    trend: v('--chart-trend', '#c98500'),
    axis: v('--chart-axis', '#8b93a7'),
    grid: v('--chart-grid', 'rgba(139, 147, 167, 0.14)'),
  }
}

function axis(c: ChartPalette, label?: string): uPlot.Axis {
  return {
    stroke: c.axis,
    label,
    labelSize: label ? 14 : undefined,
    grid: { stroke: c.grid, width: 1 },
    ticks: { stroke: c.grid, width: 1 },
    font: '11px Inter Variable, system-ui',
  }
}

function baseOpts(c: ChartPalette, width: number, height: number): uPlot.Options {
  return {
    width,
    height,
    legend: { show: false },
    cursor: { show: false },
    scales: { x: { time: false } },
    axes: [axis(c), axis(c)],
    series: [{}],
  }
}

/** A dedicated 100%-width mount inside the panel: measuring it (instead of
 *  the padded panel) and guarding on width change prevents the classic
 *  ResizeObserver ↔ setSize feedback loop inside grid tracks. */
function makeMount(el: HTMLElement): HTMLElement {
  const mount = document.createElement('div')
  mount.style.width = '100%'
  el.appendChild(mount)
  return mount
}

function observeSize(el: HTMLElement, mount: HTMLElement, u: uPlot, height: number): () => void {
  const ro = new ResizeObserver(() => {
    const w = mount.clientWidth
    if (w > 0 && w !== u.width) u.setSize({ width: w, height })
  })
  ro.observe(el)
  return () => ro.disconnect()
}

export interface StreamChartCore {
  push(tMs: number, v: number): void
  destroy(): void
}

export function createStreamChart(
  el: HTMLElement,
  opts: {
    yRange: readonly [number, number]
    windowMs: number
    height?: number
    palette?: ChartPalette
  },
): StreamChartCore {
  const c = opts.palette ?? readChartPalette()
  const height = opts.height ?? 200
  const ts: number[] = []
  const vs: (number | null)[] = []
  const mount = makeMount(el)
  const o = baseOpts(c, mount.clientWidth || 600, height)
  o.scales!.y = { range: () => [opts.yRange[0], opts.yRange[1]] as [number, number] }
  o.series.push({ stroke: c.line, width: 2, points: { show: false }, spanGaps: false })
  const u = new uPlot(o, [[], []], mount)
  const unobserve = observeSize(el, mount, u, height)
  let lastT = -Infinity

  return {
    push(tMs, v) {
      // Insert a gap break so pauses/restarts don't draw a connecting line.
      if (ts.length > 0 && tMs - lastT > MAX_GAP_MS) {
        ts.push((lastT + 1) / 1000)
        vs.push(null)
      }
      lastT = tMs
      ts.push(tMs / 1000)
      vs.push(v)
      const cutoff = (tMs - opts.windowMs) / 1000
      while (ts.length > 0 && ts[0]! < cutoff) {
        ts.shift()
        vs.shift()
      }
      u.setData([ts, vs as never])
    },
    destroy() {
      unobserve()
      u.destroy()
      mount.remove()
    },
  }
}

export interface StaticChartCore {
  destroy(): void
}

/** Recorded signal with closure-event markers. */
export function createSignalChart(
  el: HTMLElement,
  series: Series,
  events: CycleEvent[],
  yLabel: string,
  height = 220,
  palette?: ChartPalette,
): StaticChartCore {
  const c = palette ?? readChartPalette()
  // Break the line at tracking gaps.
  const xs: number[] = []
  const ys: (number | null)[] = []
  for (let i = 0; i < series.t.length; i++) {
    if (i > 0 && series.t[i]! - series.t[i - 1]! > MAX_GAP_MS) {
      xs.push((series.t[i - 1]! + 1) / 1000)
      ys.push(null)
    }
    xs.push(series.t[i]! / 1000)
    ys.push(series.v[i]!)
  }
  // Marker series: values only at the sample nearest each event.
  const markers: (number | null)[] = xs.map(() => null)
  for (const ev of events) {
    const target = ev.tMs / 1000
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i]! - target)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    markers[best] = ys[best] ?? null
  }
  const mount = makeMount(el)
  const o = baseOpts(c, mount.clientWidth || 600, height)
  o.axes = [axis(c, 'time (s)'), axis(c, yLabel)]
  o.series.push(
    { stroke: c.line, width: 2, points: { show: false }, spanGaps: false },
    {
      stroke: c.marker,
      paths: () => null,
      points: { show: true, size: 7, fill: c.marker },
    },
  )
  const u = new uPlot(o, [xs, ys as never, markers as never], mount)
  const unobserve = observeSize(el, mount, u, height)
  return {
    destroy() {
      unobserve()
      u.destroy()
      mount.remove()
    },
  }
}

/** Per-event values (amplitude, interval, …) with an optional trend line. */
export function createEventChart(
  el: HTMLElement,
  values: number[],
  yLabel: string,
  opts: { trend?: boolean; height?: number; palette?: ChartPalette } = {},
): StaticChartCore {
  const c = opts.palette ?? readChartPalette()
  const height = opts.height ?? 200
  const xs = values.map((_, i) => i + 1)
  const mount = makeMount(el)
  const o = baseOpts(c, mount.clientWidth || 600, height)
  o.axes = [axis(c, 'event #'), axis(c, yLabel)]
  o.series.push({
    stroke: c.line,
    width: 1,
    dash: [4, 4],
    points: { show: true, size: 6, fill: c.line },
  })
  const data: uPlot.AlignedData = [xs, values]
  if (opts.trend && values.length >= 2) {
    const { slope, intercept } = linearRegression(
      values.map((_, i) => i),
      values,
    )
    if (Number.isFinite(slope)) {
      o.series.push({ stroke: c.trend, width: 2, points: { show: false } })
      ;(data as unknown as number[][]).push(xs.map((_, i) => intercept + slope * i))
    }
  }
  const u = new uPlot(o, data, mount)
  const unobserve = observeSize(el, mount, u, height)
  return {
    destroy() {
      unobserve()
      u.destroy()
      mount.remove()
    },
  }
}

/** Longitudinal trend: a time-scaled scatter of one metric's values across
 *  sessions, with an optional Theil–Sen line. `points.x` is epoch seconds
 *  (uPlot's time-scale convention); `line` is already in that same x domain
 *  (y = m·x + b) — callers convert from the days-relative Trend.line before
 *  calling this, keeping this module unit-agnostic like createEventChart. */
export function createTrendChart(
  el: HTMLElement,
  points: { x: number; y: number | null }[],
  line: { m: number; b: number } | null,
  yLabel: string,
  opts: { height?: number; palette?: ChartPalette } = {},
): StaticChartCore {
  const c = opts.palette ?? readChartPalette()
  const height = opts.height ?? 220
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const mount = makeMount(el)
  const o = baseOpts(c, mount.clientWidth || 600, height)
  o.scales!.x = { time: true }
  o.axes = [axis(c), axis(c, yLabel)]
  o.series.push({
    stroke: c.marker,
    paths: () => null,
    points: { show: true, size: 7, fill: c.marker },
  })
  const data: uPlot.AlignedData = [xs, ys as never]
  if (line && xs.length > 0) {
    o.series.push({ stroke: c.trend, width: 2, points: { show: false } })
    ;(data as unknown as number[][]).push(xs.map((x) => line.m * x + line.b))
  }
  const u = new uPlot(o, data, mount)
  const unobserve = observeSize(el, mount, u, height)
  return {
    destroy() {
      unobserve()
      u.destroy()
      mount.remove()
    },
  }
}
