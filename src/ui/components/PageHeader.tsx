// Shared screen header: title + optional description on the left, optional
// actions (buttons/chips) right-aligned. Single source for the title scale
// (22px / semibold / h1) that used to drift between h1/h2 and 20px/22px
// across screens. `children` renders below the description for screens that
// need an extra line (e.g. ResultsScreen's saved-state chip).
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export function PageHeader({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-start justify-between gap-4', className)}>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
