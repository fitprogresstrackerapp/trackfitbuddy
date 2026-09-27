import { ArrowLeft } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'

import { ADMIN_NAV } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'
import { cn } from '@/lib/utils'

import { ProfileMenu } from './components/profile-menu'
import { Sidebar, SidebarLink } from './components/sidebar'
import { SkipLink } from './components/skip-link'
import { TopBar } from './components/top-bar'

const BACK_TO_APP = { label: 'Back to app', to: ROUTES.home, icon: ArrowLeft }

/** Admin sections as a horizontally scrolling strip below lg. */
function AdminSectionStrip() {
  return (
    <nav aria-label="Admin" className="border-b border-border lg:hidden">
      <ul className="flex gap-1 overflow-x-auto px-4 py-2 sm:px-6 md:px-8">
        {ADMIN_NAV.map((item) => (
          <li key={item.to} className="shrink-0">
            <NavLink
              to={item.to}
              end={item.to === ROUTES.admin}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center rounded-sm px-2.5 label-mono transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-surface-1 text-foreground'
                    : 'text-muted-foreground hover:text-foreground-secondary',
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
        <li className="shrink-0">
          <NavLink
            to={ROUTES.home}
            className="flex h-8 items-center gap-1.5 rounded-sm px-2.5 label-mono text-muted-foreground outline-none hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            App
          </NavLink>
        </li>
      </ul>
    </nav>
  )
}

/**
 * Admin shell — same design system, separate navigation (spec §8, §78).
 * Reachable only through the ADMIN / SUPER_ADMIN route guard.
 */
export function AdminLayout() {
  return (
    <div className="min-h-dvh">
      <SkipLink />
      <Sidebar
        items={ADMIN_NAV}
        navLabel="Admin"
        tag="Control"
        secondary={<SidebarLink item={BACK_TO_APP} />}
        footer={<ProfileMenu variant="full" />}
      />
      <div className="lg:pl-sidebar">
        <TopBar items={ADMIN_NAV} tag="Admin" brandClassName="" />
        <AdminSectionStrip />
        <main
          id="main"
          className="mx-auto w-full max-w-(--container-content) px-4 pt-6 pb-14 sm:px-6 md:px-8 md:pt-8 lg:px-12 lg:pt-12"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
