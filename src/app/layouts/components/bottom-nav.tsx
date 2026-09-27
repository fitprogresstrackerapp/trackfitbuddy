import { NavLink } from 'react-router'

import { PRIMARY_NAV } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'

/** Mobile/tablet primary navigation (spec §8). Hidden at `lg`, where the sidebar takes over. */
export function BottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto grid h-bottom-nav max-w-2xl grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === ROUTES.home}
                className={({ isActive }) =>
                  cn(
                    'flex h-full flex-col items-center justify-center gap-1 border-t-2 text-[0.625rem] font-semibold tracking-[0.08em] uppercase transition-colors',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground-secondary',
                  )
                }
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
