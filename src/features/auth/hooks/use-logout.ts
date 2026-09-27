import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'

import { ROUTES } from '@/constants/routes'

import { useAuth } from '../auth-context'

/** Ends the session, clears cached user data (in AuthProvider) and replaces history with Login. */
export function useLogout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)

  const logout = useCallback(async () => {
    setPending(true)
    await signOut()
    void navigate(ROUTES.login, { replace: true })
  }, [signOut, navigate])

  return { logout, pending }
}
