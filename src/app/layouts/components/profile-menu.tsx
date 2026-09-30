import { ChevronsUpDown, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router'

import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PROFILE_NAV, staffEntryFor } from '@/constants/navigation'
import { useAccount } from '@/features/auth/auth-context'
import { useLogout } from '@/features/auth/hooks/use-logout'
import type { AppRole } from '@/features/auth/types'
import { cn } from '@/lib/utils'

function roleLabel(roles: readonly AppRole[]): string | null {
  if (roles.includes('SUPER_ADMIN')) return 'Super admin'
  if (roles.includes('ADMIN')) return 'Admin'
  if (roles.includes('MANAGER')) return 'Manager'
  return null
}

/**
 * Account menu: Profile, Admin (admins only — navigation, not authorization),
 * Log out. Settings will join the first group when they exist.
 * Shows only the name and role — no phone number or health data.
 */
export function ProfileMenu({ variant }: { variant: 'compact' | 'full' }) {
  const { profile, roles } = useAccount()
  const { logout } = useLogout()
  const navigate = useNavigate()
  const name = profile.name ?? 'Account'
  const role = roleLabel(roles)
  const staffEntry = staffEntryFor(roles)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          'flex cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-surface-1',
          variant === 'compact' ? 'p-1' : 'w-full gap-3 px-2 py-2 text-left hover:bg-surface-1/60',
        )}
      >
        <Avatar name={profile.name} size={variant === 'compact' ? 'sm' : 'md'} />
        {variant === 'full' && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              {role && <span className="block label-mono text-muted-foreground">{role}</span>}
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'compact' ? 'end' : 'start'}
        side={variant === 'compact' ? 'bottom' : 'top'}
        className={variant === 'full' ? 'w-(--radix-dropdown-menu-trigger-width)' : undefined}
      >
        <DropdownMenuLabel>
          <span className="block truncate">{name}</span>
          {role && <span className="label-mono text-muted-foreground">{role}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void navigate(PROFILE_NAV.to)}>
            <PROFILE_NAV.icon aria-hidden="true" />
            {PROFILE_NAV.label}
          </DropdownMenuItem>
          {staffEntry && (
            <DropdownMenuItem onSelect={() => void navigate(staffEntry.to)}>
              <staffEntry.icon aria-hidden="true" />
              {staffEntry.label}
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
