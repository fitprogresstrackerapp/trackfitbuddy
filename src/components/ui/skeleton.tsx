import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/** Placeholder block shown while data loads. Match the size of the real content. */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('animate-pulse rounded-xs bg-surface-2', className)}
      {...props}
    />
  )
}

export { Skeleton }
