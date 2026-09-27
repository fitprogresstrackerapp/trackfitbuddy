import { cn } from '@/lib/utils'

/** Shared nav item styling (also used by the design-system showcase). */

export function sidebarItemClass(isActive: boolean): string {
  return cn(
    'relative flex h-9 items-center gap-3 rounded-sm px-3 text-xs font-semibold tracking-[0.08em] uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
    "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:content-['']",
    isActive
      ? 'bg-surface-1 text-foreground before:bg-primary'
      : 'text-foreground-secondary before:bg-transparent hover:bg-surface-1/60 hover:text-foreground',
  )
}

export function railItemClass(isActive: boolean): string {
  return cn(
    'flex w-15 flex-col items-center gap-1 rounded-sm py-2 text-[0.625rem] font-semibold tracking-[0.06em] uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive
      ? 'bg-surface-1 text-foreground [&_svg]:text-primary'
      : 'text-muted-foreground hover:text-foreground-secondary',
  )
}

export function bottomItemClass(isActive: boolean): string {
  return cn(
    'flex h-full flex-col items-center justify-center gap-1 border-t-2 text-[0.625rem] font-semibold tracking-[0.06em] uppercase transition-colors outline-none focus-visible:bg-surface-2',
    isActive
      ? 'border-primary text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground-secondary',
  )
}
