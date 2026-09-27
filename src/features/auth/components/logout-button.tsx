import { LogOut } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'

import { useAuth } from '../auth-context'

type LogoutButtonProps = Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>

/** Ends the session, clears cached user data and replaces history with Login. */
export function LogoutButton({ disabled, ...props }: LogoutButtonProps) {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  async function handleClick() {
    setPending(true)
    await signOut()
    void navigate(ROUTES.login, { replace: true })
  }

  return (
    <Button {...props} disabled={disabled ?? pending} onClick={() => void handleClick()}>
      <LogOut aria-hidden="true" />
      {pending ? 'Logging out…' : 'Log out'}
    </Button>
  )
}
