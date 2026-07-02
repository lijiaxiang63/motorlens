import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'

const COUNT_UP_MS = 350

/** Animates the leading numeric portion of `target` from 0 on mount, then
 * snaps to the exact final string — display-only, runs once after the
 * report already exists (nothing here touches `__lastReport` or the frame
 * path). Skipped entirely under prefers-reduced-motion. */
function useCountUp(target: string, enabled: boolean): string {
  const [display, setDisplay] = useState(target)

  useEffect(() => {
    if (!enabled) {
      setDisplay(target)
      return
    }
    const match = /^-?\d+(\.\d+)?/.exec(target)
    if (!match || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target)
      return
    }
    const numStr = match[0]
    const decimals = numStr.includes('.') ? numStr.split('.')[1]!.length : 0
    const end = parseFloat(numStr)
    const suffix = target.slice(numStr.length)
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / COUNT_UP_MS)
      const eased = 1 - (1 - t) ** 3
      if (t >= 1) {
        setDisplay(target)
        return
      }
      setDisplay((end * eased).toFixed(decimals) + suffix)
      raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animate once per mount, not on every target change
  }, [])

  return display
}

export function MetricCard({
  label,
  value,
  sub,
  tone,
  animate = true,
}: {
  label: string
  value: string
  sub?: string | undefined
  tone?: 'accent' | 'warn' | undefined
  /** Count up from 0 on mount (results screen only — set false for any
   * live-updating usage, e.g. a streaming stat tile). */
  animate?: boolean
}) {
  const displayValue = useCountUp(value, animate)

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface px-3.5 py-3',
        tone === 'accent' && 'border-accent/50',
        tone === 'warn' && 'border-warn/50',
      )}
    >
      <div className="text-xs uppercase tracking-[0.6px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-0.5 text-[26px] font-bold tabular-nums',
          tone === 'accent' && 'text-accent',
          tone === 'warn' && 'text-warn',
        )}
      >
        {displayValue}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
