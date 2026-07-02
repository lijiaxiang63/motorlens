import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export type ChipState = 'ok' | 'warn' | 'err' | 'idle'

const stateClass: Record<ChipState, string> = {
  ok: 'text-ok border-ok/40',
  warn: 'text-warn border-warn/40',
  err: 'text-danger border-danger/40',
  idle: 'text-muted-foreground border-border',
}

export function StatusChip({
  state,
  className,
  children,
}: {
  state: ChipState
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-surface px-2.5 py-1 text-xs',
        stateClass[state],
        className,
      )}
    >
      {children}
    </span>
  )
}
