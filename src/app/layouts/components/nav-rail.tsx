import { Link, NavLink } from 'react-router'

import type { NavItem } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'

import { BrandMark } from './brand'
import { railItemClass } from './nav-styles'

/** Tablet navigation (md – lg): icon + short label rail. Profile lives in the top bar. */
export function NavRail({ items, navLabel }: { items: readonly NavItem[]; navLabel: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-rail flex-col items-center border-r border-border bg-background md:flex lg:hidden">
      <Link
        to={ROUTES.home}
        aria-label="Home"
        className="flex h-top-bar shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BrandMark />
      </Link>
      <nav aria-label={navLabel} className="flex flex-col items-center gap-1 pt-3">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === ROUTES.home}
              className={({ isActive }) => railItemClass(isActive)}
            >
              <Icon aria-hidden="true" className="size-5" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
