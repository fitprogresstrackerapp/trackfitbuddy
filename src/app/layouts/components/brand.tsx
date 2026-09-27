import { APP_NAME } from '@/constants/app'
import { cn } from '@/lib/utils'

/** Three ascending bars — the product mark (matches the favicon). Decorative. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={cn('size-5 shrink-0', className)}
      fill="none"
    >
      <rect x="2" y="11" width="4" height="7" className="fill-muted-foreground" />
      <rect x="8" y="7" width="4" height="11" className="fill-foreground-secondary" />
      <rect x="14" y="2" width="4" height="16" className="fill-primary" />
    </svg>
  )
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="label-mono text-foreground">{APP_NAME}</span>
    </span>
  )
}
