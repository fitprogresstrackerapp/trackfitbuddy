import { Outlet } from 'react-router'

import { Brand } from './components/brand'

const PILLARS = ['Nutrition', 'Training', 'Activity', 'Body'] as const

/**
 * Shell for login and onboarding: no app navigation.
 * Mobile/tablet: single centred column. Desktop: a quiet identity panel on the
 * left so the form is not a lone island on a wide screen.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-[42%] max-w-xl flex-col justify-between border-r border-border bg-surface-1 p-12 lg:flex">
        <Brand />
        <div className="space-y-6">
          <p className="label-mono text-primary">Fitness intelligence</p>
          <p className="heading-page text-5xl! leading-[0.95] text-foreground">
            Data-rich underneath.
            <br />
            <span className="text-foreground-secondary">Insight-rich on top.</span>
          </p>
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 label-mono text-muted-foreground">
          {PILLARS.map((pillar) => (
            <li key={pillar}>{pillar}</li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-1 flex-col px-4 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:px-6">
        <header className="mx-auto w-full max-w-md lg:hidden">
          <Brand />
        </header>
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
