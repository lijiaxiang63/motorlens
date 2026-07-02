// Pure SVG longitudinal sparkline — deliberately not a uPlot chart. SVG
// resolves CSS custom properties live, so it recolors on theme switch for
// free; canvas charts elsewhere in this app (ui/charts/uplotCore.ts) read
// the palette once at chart creation and are recreated on theme switch
// instead, since canvas paints don't track CSS changes.

import type { TrendPoint } from '../../analysis/trends'
import type { Hand } from '../../types'

const HAND_COLOR: Record<Hand, string> = {
  left: 'var(--chart-left)',
  right: 'var(--chart-right)',
}

/** Splits a null-inclusive point list into runs of consecutive non-null
 *  values — a null breaks the run so the polyline never bridges a gap. */
function nonNullRuns(points: TrendPoint[]): TrendPoint[][] {
  const runs: TrendPoint[][] = []
  let current: TrendPoint[] = []
  for (const p of points) {
    if (p.value === null) {
      if (current.length > 0) runs.push(current)
      current = []
    } else {
      current.push(p)
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}

export function Sparkline({
  series,
  width = 160,
  height = 34,
}: {
  series: { hand: Hand; points: TrendPoint[] }[]
  width?: number
  height?: number
}) {
  const allNonNull = series.flatMap((s) => s.points.filter((p) => p.value !== null))
  if (allNonNull.length === 0) {
    return (
      <svg width={width} height={height} role="img" aria-label="No data yet">
        <text
          x={width / 2}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          className="fill-muted-foreground"
        >
          —
        </text>
      </svg>
    )
  }

  const times = allNonNull.map((p) => Date.parse(p.startedAt))
  const values = allNonNull.map((p) => p.value!)
  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const vMin = Math.min(...values)
  const vMax = Math.max(...values)
  const pad = 5
  const xOf = (t: number) =>
    tMax === tMin ? width / 2 : pad + ((t - tMin) / (tMax - tMin)) * (width - 2 * pad)
  const yOf = (v: number) =>
    vMax === vMin ? height / 2 : height - pad - ((v - vMin) / (vMax - vMin)) * (height - 2 * pad)

  return (
    <svg width={width} height={height} role="img" aria-label="Trend sparkline">
      {series.map((s) => {
        const color = HAND_COLOR[s.hand]
        return (
          <g key={s.hand}>
            {nonNullRuns(s.points).map((run, i) => (
              <g key={i}>
                {run.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={run
                      .map((p) => `${xOf(Date.parse(p.startedAt))},${yOf(p.value!)}`)
                      .join(' ')}
                  />
                )}
                {run.map((p) => (
                  <circle
                    key={p.resultId}
                    cx={xOf(Date.parse(p.startedAt))}
                    cy={yOf(p.value!)}
                    r={run.length > 1 ? 2.5 : 3.5}
                    fill={color}
                  />
                ))}
              </g>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
