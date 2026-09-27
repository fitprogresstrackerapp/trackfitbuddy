import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // text-base on mobile prevents iOS zoom-on-focus.
        'flex h-11 w-full min-w-0 rounded-md border border-input bg-surface-1 px-3 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground md:text-sm',
        'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/30',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
