import { NavLink } from 'react-router'

import { APP_NAME } from '@/constants/app'
import { ICONS } from '@/constants/icons'
import { PRIMARY_NAV, PROFILE_NAV, type NavItem } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { useAccount } from '@/features/auth/auth-context'
import { LogoutButton } from '@/features/auth/components/logout-button'
import { ADMIN_ROLES, hasAnyRole } from '@/features/auth/lib/roles'
import { cn } from '@/lib/utils'

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === ROUTES.home}
      className={({ isActive }) =>
        cn(
          'group flex h-10 items-center gap-3 border-l-2 px-4 text-xs font-semibold tracking-[0.08em] uppercase transition-colors',
          isActive
            ? 'border-primary bg-primary-surface text-foreground'
            : 'border-transparent text-foreground-secondary hover:bg-surface-2 hover:text-foreground',
        )
      }
    >
      <Icon aria-hidden="true" className="size-4" />
      {item.label}
    </NavLink>
  )
}

/** Persistent desktop navigation (spec §8). Hidden below `lg`. */
export function Sidebar() {
  const { roles } = useAccount()
  const showAdmin = hasAnyRole(roles, ADMIN_ROLES) // navigation only; access is enforced server-side

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-border bg-surface-1 lg:flex">
      <div className="flex h-top-bar items-center border-b border-border px-4">
        <span className="label-mono text-foreground">{APP_NAME}</span>
      </div>
      <nav aria-label="Primary" className="flex flex-1 flex-col py-4">
        <div className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
        <div className="my-4 border-t border-border" />
        <SidebarLink item={PROFILE_NAV} />
        {showAdmin && (
          <SidebarLink item={{ label: 'Admin', to: ROUTES.admin, icon: ICONS.admin }} />
        )}
      </nav>
      <div className="border-t border-border p-3">
        <LogoutButton variant="ghost" size="sm" className="w-full justify-start" />
      </div>
    </aside>
  )
}
