import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { IconButton } from './button'

/*
 * Dialog (centred, desktop-first) and Sheet (bottom on mobile, right on
 * desktop). Both are Radix Dialog: focus trap, Escape to close, focus return
 * and aria wiring come built in. Every dialog needs a DialogTitle/SheetTitle.
 */

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close

function Overlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/75 data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
  )
}

function CloseButton() {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton label="Close" icon={X} size="sm" className="-mt-1 -mr-1.5" />
    </DialogPrimitive.Close>
  )
}

interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: 'sm' | 'md'
}

function DialogContent({ className, children, size = 'sm', ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-md border border-border bg-surface-1 p-5 text-foreground shadow-2xl shadow-black/50 outline-none data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in',
          size === 'sm' ? 'max-w-md' : 'max-w-xl',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

interface HeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Monospace label above the title, e.g. "LOCKED RECORD". */
  eyebrow?: string
}

function DialogHeader({ title, description, eyebrow }: HeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="label-mono text-muted-foreground">{eyebrow}</p>}
        <DialogPrimitive.Title className="heading-block text-foreground">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="text-sm text-foreground-secondary">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
      <CloseButton />
    </div>
  )
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** `responsive` = bottom sheet below md, right panel from md up. */
  side?: 'bottom' | 'right' | 'responsive'
}

const sheetSides = {
  bottom:
    'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-md border-t pb-[max(env(safe-area-inset-bottom),1.25rem)] data-[state=closed]:animate-sheet-out-bottom data-[state=open]:animate-sheet-in-bottom',
  right:
    'inset-y-0 right-0 h-dvh w-full max-w-md border-l pb-5 data-[state=closed]:animate-sheet-out-right data-[state=open]:animate-sheet-in-right',
  responsive:
    'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-md border-t pb-[max(env(safe-area-inset-bottom),1.25rem)] data-[state=closed]:animate-sheet-out-bottom data-[state=open]:animate-sheet-in-bottom md:inset-x-auto md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-t-0 md:border-l md:pb-5 md:data-[state=closed]:animate-sheet-out-right md:data-[state=open]:animate-sheet-in-right',
} as const

function SheetContent({ className, children, side = 'responsive', ...props }: SheetContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'fixed z-50 flex flex-col gap-5 overflow-y-auto border-border bg-surface-1 px-5 pt-5 text-foreground shadow-2xl shadow-black/50 outline-none',
          sheetSides[side],
          className,
        )}
        {...props}
      >
        {side !== 'right' && (
          <span
            aria-hidden="true"
            className={cn(
              'mx-auto -mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-border',
              side === 'responsive' && 'md:hidden',
            )}
          />
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

const SheetHeader = DialogHeader
const SheetFooter = DialogFooter

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
}
