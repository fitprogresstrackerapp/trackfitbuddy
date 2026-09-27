import { ArrowLeft } from 'lucide-react'
import { Link, Outlet } from 'react-router'

import { Button } from '@/components/ui/button'
import { ICONS } from '@/constants/icons'
import { ROUTES } from '@/constants/routes'

/**
 * Admin shell — kept separate from the user shell (spec §8: separate admin navigation).
 * The full admin navigation (spec §78) is added with the admin feature.
 */
export function AdminLayout() {
  const AdminIcon = ICONS.admin
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-surface-1 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-top-bar w-full max-w-7xl items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-2 text-foreground">
            <AdminIcon aria-hidden="true" className="size-4 text-primary" />
            <span className="label-mono">Admin</span>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to={ROUTES.home}>
              <ArrowLeft aria-hidden="true" />
              App
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 pt-6 pb-12 md:px-8 lg:pt-10">
        <Outlet />
      </main>
    </div>
  )
}
