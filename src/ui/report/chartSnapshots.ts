// Renders a uPlot chart off-layout at a fixed width/light palette and
// snapshots it to a PNG data URL — deterministic pagination for the clinical
// report's printed charts (print CSS can't recolor an already-painted
// canvas, and a live-resizing chart would paginate differently depending on
// window width at print time).
//
// Sharpness note: uPlot already sizes its canvas backing store from the
// live `devicePixelRatio` internally (a HiDPI/Retina display yields a sharp
// 2x-equivalent canvas for free); there is no supported way to force a
// higher ratio from application code — `uPlot.pxRatio` is a read-only mirror
// of that internal value for inspection, not an input the renderer reads
// back (verified against the installed uplot build; writing to it is a
// silent no-op). Don't reintroduce a `uPlot.pxRatio = N` write here.

import { readChartPalette, type ChartPalette, type StaticChartCore } from '../charts/uplotCore'

const SNAPSHOT_WIDTH_PX = 680

/** Builds one chart via `build`, waits for fonts + a paint, snapshots its
 *  canvas to a PNG data URL, then tears the chart down. */
export async function snapshotChart(
  build: (el: HTMLElement, palette: ChartPalette) => StaticChartCore,
  opts: { widthPx?: number } = {},
): Promise<string> {
  const widthPx = opts.widthPx ?? SNAPSHOT_WIDTH_PX
  await document.fonts.ready

  const host = document.createElement('div')
  host.className = 'report-light'
  Object.assign(host.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${widthPx}px`,
  })
  document.body.appendChild(host)

  try {
    const palette = readChartPalette(host)
    const chart = build(host, palette)
    // One rAF so the initial synchronous uPlot paint has definitely flushed
    // before we read the canvas back out.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    const canvas = host.querySelector('canvas')
    if (!canvas) throw new Error('chart snapshot: no canvas produced')
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png')
    chart.destroy()
    return dataUrl
  } finally {
    host.remove()
  }
}
