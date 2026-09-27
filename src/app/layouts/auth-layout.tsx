import { Outlet } from 'react-router'

import { APP_NAME } from '@/constants/app'

/** Minimal shell for login and onboarding: no app navigation. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col px-4 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="mx-auto w-full max-w-md">
        <span className="label-mono text-foreground">{APP_NAME}</span>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <Outlet />
      </main>
    </div>
  )
}
