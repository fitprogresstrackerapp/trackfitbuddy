import { Outlet } from 'react-router'

import { BottomNav } from './components/bottom-nav'
import { Sidebar } from './components/sidebar'
import { TopBar } from './components/top-bar'

/**
 * Authenticated user shell.
 *
 * - Mobile / tablet (< lg): top bar + fixed bottom nav, single centred column.
 * - Desktop (≥ lg): persistent sidebar, wider content area so pages can use
 *   multi-column compositions instead of a stretched mobile column.
 */
export function AppLayout() {
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <div className="lg:pl-sidebar">
        <TopBar />
        <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+1.5rem)] md:px-8 lg:max-w-6xl lg:px-10 lg:pt-10 lg:pb-12">
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
