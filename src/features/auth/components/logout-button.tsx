import { LogOut } from 'lucide-react'
import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'

import { useLogout } from '../hooks/use-logout'

type LogoutButtonProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>

export function LogoutButton({ disabled, ...props }: LogoutButtonProps) {
  const { logout, pending } = useLogout()
  return (
    <Button {...props} disabled={disabled ?? pending} onClick={() => void logout()}>
      <LogOut aria-hidden="true" />
      {pending ? 'Logging out…' : 'Log out'}
    </Button>
  )
}
