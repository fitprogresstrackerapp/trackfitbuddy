import type { ReactNode } from 'react'

import { AppErrorBoundary } from './app-error-boundary'
import { QueryProvider } from './query-provider'

/**
 * Global provider composition, outermost first.
 *
 * - AppErrorBoundary: catches errors thrown by providers themselves.
 * - QueryProvider: TanStack Query cache for all server state.
 *
 * Supabase needs no provider: `getSupabaseClient()` is a module singleton.
 * The auth/session provider is added here with the authentication feature,
 * inside QueryProvider so it can share the query cache. The UI is dark-only
 * (spec §2), so there is no theme provider.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <QueryProvider>{children}</QueryProvider>
    </AppErrorBoundary>
  )
}
