// Form primitives: styled native controls (a clinical data-entry form wants
// native semantics) plus a labeled-field wrapper.

import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const controlClass =
  'w-full rounded-lg border bg-surface-2 px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent disabled:opacity-50'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'cursor-pointer', className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClass, className)} {...props} />
}

export function Field({
  label,
  required,
  children,
  className,
}: {
  label: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('flex flex-col gap-1 text-[12.5px] text-muted-foreground', className)}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}

/** Native checkbox with label — used for the save-video / detection toggles. */
export function CheckboxRow({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean
  onChange(v: boolean): void
  children: ReactNode
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground',
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 cursor-pointer accent-accent"
      />
      <span>{children}</span>
    </label>
  )
}
