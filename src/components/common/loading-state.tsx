import { cn } from '@/lib/utils'

import { Spinner } from './spinner'

interface LoadingStateProps {
  label?: string
  className?: string
}

/** Inline loading block for a section or panel. */
export function LoadingState({ label = 'Loading', className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex items-center gap-3 py-8 text-muted-foreground', className)}
    >
      <Spinner />
      <span className="label-mono">{label}</span>
    </div>
  )
}

/** Full-area loader used while a route or the app shell is loading. */
export function PageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <LoadingState label={label} />
    </div>
  )
}
