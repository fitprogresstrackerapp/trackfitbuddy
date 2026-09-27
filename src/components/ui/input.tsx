import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/** Shared field styling for inputs, textareas and select triggers. */
export const fieldClassName = cn(
  // text-base below md prevents iOS zoom-on-focus.
  'w-full min-w-0 rounded-sm border border-input bg-surface-1 px-3 text-base text-foreground transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground md:text-sm',
  'hover:border-foreground-secondary/30',
  'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input',
  'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25',
)

function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClassName, 'h-10', className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClassName, 'min-h-24 resize-y py-2.5 leading-relaxed', className)}
      {...props}
    />
  )
}

type DatePickerProps = Omit<ComponentProps<'input'>, 'type'>

/**
 * Date field. Uses the native date control: accessible, keyboard-friendly and
 * the platform's own picker on mobile. Values are ISO dates (YYYY-MM-DD).
 */
function DatePicker({ className, ...props }: DatePickerProps) {
  return (
    <input
      type="date"
      data-slot="date-picker"
      className={cn(fieldClassName, 'h-10 font-mono tracking-tight', className)}
      {...props}
    />
  )
}

export { DatePicker, Input, Textarea }
