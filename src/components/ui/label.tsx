import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('label-section text-foreground-secondary select-none', className)}
      {...props}
    />
  )
}

export { Label }
