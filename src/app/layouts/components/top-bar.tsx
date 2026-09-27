import { Link, useLocation } from 'react-router'

import { findNavItem, type NavItem } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'

import { BrandMark } from './brand'
import { ProfileMenu } from './profile-menu'

interface TopBarProps {
  /** Items used to name the current section, e.g. "FOOD". */
  items: readonly NavItem[]
  /** Fixed tag before the section, e.g. "ADMIN". */
  tag?: string
  /** Show the brand mark (on mobile; the tablet rail already shows it). */
  brandClassName?: string
  /** Hide at this breakpoint and up. */
  className?: string
}

/** Mobile/tablet header: brand, page context and the account menu (top right). */
export function TopBar({ items, tag, brandClassName = 'md:hidden', className }: TopBarProps) {
  const { pathname } = useLocation()
  const current = findNavItem(items, pathname)

  return (
    <header
      className={cn(
        'sticky top-0 z-20 border-b border-border bg-background pt-[env(safe-area-inset-top)] lg:hidden',
        className,
      )}
    >
      <div className="flex h-top-bar items-center gap-3 px-4 sm:px-6 md:px-8">
        <Link
          to={ROUTES.home}
          aria-label="Home"
          className={cn(
            'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            brandClassName,
          )}
        >
          <BrandMark />
        </Link>
        <p className="flex min-w-0 items-center gap-2 truncate label-mono text-foreground">
          {tag && <span className="text-primary">{tag}</span>}
          {tag && current && <span className="text-border">/</span>}
          {current && <span className="truncate">{current.label}</span>}
        </p>
        <div className="ml-auto">
          <ProfileMenu variant="compact" />
        </div>
      </div>
    </header>
  )
}
