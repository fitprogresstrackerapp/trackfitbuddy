import { NavLink } from 'react-router'

import type { NavItem } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'

import { bottomItemClass } from './nav-styles'

/** Mobile primary navigation (< md). Content reserves its height + safe area. */
export function BottomNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul
        className="grid h-bottom-nav"
        style={{ gridTemplateColumns: `repeat(${String(items.length)}, 1fr)` }}
      >
        {items.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === ROUTES.home}
                className={({ isActive }) => bottomItemClass(isActive)}
              >
                <Icon aria-hidden="true" className="size-5" />
                {item.label}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
