import type { ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface FieldControlProps {
  id: string
  'aria-invalid': boolean
  'aria-describedby': string | undefined
}

interface FormFieldProps {
  id: string
  label: string
  hint?: ReactNode
  error?: string | undefined
  className?: string
  /** Render the control with the wiring for label, hint and error. */
  children: (control: FieldControlProps) => ReactNode
}

/** Label + control + hint + error, with accessible associations. */
export function FormField({ id, label, hint, error, className, children }: FormFieldProps) {
  // The error replaces the hint on screen, so only one of them is referenced:
  // aria-describedby must never point at an element that is not rendered.
  const errorId = error ? `${id}-error` : undefined
  const hintId = !error && hint ? `${id}-hint` : undefined
  const describedBy = errorId ?? hintId

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
