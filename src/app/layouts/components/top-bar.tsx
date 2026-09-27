import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/constants/app'
import { PROFILE_NAV } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'

/** Mobile/tablet header with the profile control at top-right (spec §8). Hidden at `lg`. */
export function TopBar() {
  const ProfileIcon = PROFILE_NAV.icon
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm lg:hidden">
      <div className="mx-auto flex h-top-bar w-full max-w-2xl items-center justify-between px-4 md:px-8">
        <Link to={ROUTES.home} className="label-mono text-foreground">
          {APP_NAME}
        </Link>
        <Button asChild variant="ghost" size="icon" aria-label={PROFILE_NAV.label}>
          <Link to={PROFILE_NAV.to}>
            <ProfileIcon aria-hidden="true" className="size-5" />
          </Link>
        </Button>
      </div>
    </header>
  )
}
