import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface AdornedInputProps extends ComponentProps<'input'> {
  leading?: ReactNode
  trailing?: ReactNode
}

/** Input with a fixed monospace prefix/suffix, e.g. "+91" or "KG". */
export function AdornedInput({ leading, trailing, className, ...props }: AdornedInputProps) {
  return (
    <div
      className={cn(
        'flex h-11 w-full items-stretch overflow-hidden rounded-md border border-input bg-surface-1 transition-colors',
        'focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/30',
        'has-[input[aria-invalid=true]]:border-destructive',
        className,
      )}
    >
      {leading && (
        <span className="flex items-center border-r border-border px-3 label-mono text-foreground-secondary">
          {leading}
        </span>
      )}
      <input
        className="min-w-0 flex-1 bg-transparent px-3 text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
        {...props}
      />
      {trailing && (
        <span className="flex items-center border-l border-border px-3 label-mono text-foreground-secondary">
          {trailing}
        </span>
      )}
    </div>
  )
}
