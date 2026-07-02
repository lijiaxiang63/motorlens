// Confirmation dialog on Radix AlertDialog. Replaces every window.confirm()
// from the vanilla app. Use the imperative <ConfirmDialog> wrapper for the
// common "destructive action?" pattern.

import { AlertDialog as RadixAlertDialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm(): void
  onCancel?(): void
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <RadixAlertDialog.Content
          className={cn(
            'dialog-content fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border bg-surface p-5 shadow-panel outline-none',
          )}
        >
          <RadixAlertDialog.Title className="text-[15px] font-semibold">
            {title}
          </RadixAlertDialog.Title>
          {description != null && (
            <RadixAlertDialog.Description className="mt-1.5 text-[13.5px] text-muted-foreground">
              {description}
            </RadixAlertDialog.Description>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <RadixAlertDialog.Cancel asChild>
              <Button variant="ghost" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </RadixAlertDialog.Cancel>
            <RadixAlertDialog.Action asChild>
              <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </RadixAlertDialog.Action>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  )
}
