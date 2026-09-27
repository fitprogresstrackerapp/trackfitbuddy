import { cn } from '@/lib/utils'

function initialsOf(name: string | null): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

interface AvatarProps {
  name: string | null
  size?: 'sm' | 'md'
  className?: string
}

/** Initials block — no photos in Phase 1. Decorative: pair with a text label. */
export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const initials = initialsOf(name)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-sm border border-primary/40 bg-primary-surface label-mono text-foreground',
        size === 'sm' ? 'size-7 text-[0.625rem]' : 'size-8',
        className,
      )}
    >
      {initials || '·'}
    </span>
  )
}
