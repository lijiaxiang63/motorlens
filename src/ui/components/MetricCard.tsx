import { cn } from '../lib/cn'

export function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string | undefined
  tone?: 'accent' | 'warn' | undefined
}) {
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
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}
