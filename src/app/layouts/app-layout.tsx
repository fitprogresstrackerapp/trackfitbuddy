import { Outlet } from 'react-router'

import { ADMIN_ENTRY, PRIMARY_NAV, PROFILE_NAV } from '@/constants/navigation'
import { useAccount } from '@/features/auth/auth-context'
import { ADMIN_ROLES, hasAnyRole } from '@/features/auth/lib/roles'

import { BottomNav } from './components/bottom-nav'
import { NavRail } from './components/nav-rail'
import { ProfileMenu } from './components/profile-menu'
import { SidebarLink, Sidebar } from './components/sidebar'
import { SkipLink } from './components/skip-link'
import { TopBar } from './components/top-bar'

/**
 * Signed-in user shell.
 *   < md       top bar + bottom nav, single column
 *   md – lg    top bar + icon rail
 *   ≥ lg       full sidebar (profile menu at its foot)
 * Content width is capped (--container-content) so wide screens stay readable.
 */
export function AppLayout() {
  const { roles } = useAccount()
  const showAdmin = hasAnyRole(roles, ADMIN_ROLES) // navigation only; access is enforced server-side

  return (
    <div className="min-h-dvh">
      <SkipLink />
      <Sidebar
        items={PRIMARY_NAV}
        navLabel="Primary"
        secondary={
          <>
            <SidebarLink item={PROFILE_NAV} />
            {showAdmin && <SidebarLink item={ADMIN_ENTRY} />}
          </>
        }
        footer={<ProfileMenu variant="full" />}
      />
      <NavRail items={PRIMARY_NAV} navLabel="Primary" />

      <div className="md:pl-rail lg:pl-sidebar">
        <TopBar items={[...PRIMARY_NAV, PROFILE_NAV]} />
        <main
          id="main"
          className="mx-auto w-full max-w-(--container-content) px-4 pt-6 pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+2.5rem)] sm:px-6 md:px-8 md:pt-8 md:pb-14 lg:px-12 lg:pt-12"
        >
          <Outlet />
        </main>
      </div>

      <BottomNav items={PRIMARY_NAV} />
    </div>
  )
}
