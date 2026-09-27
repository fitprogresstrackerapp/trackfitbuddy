import type { ReactNode } from 'react'

import { AuthProvider } from '@/features/auth/auth-provider'

import { AppErrorBoundary } from './app-error-boundary'
import { QueryProvider } from './query-provider'

/**
 * Global provider composition, outermost first.
 *
 * - AppErrorBoundary: catches errors thrown by providers themselves
 *   (including missing Supabase configuration).
 * - QueryProvider: TanStack Query cache for all server state.
 * - AuthProvider: session + account state; clears the query cache whenever
 *   the signed-in user changes.
 *
 * Supabase needs no provider: `getSupabaseClient()` is a module singleton.
 * The UI is dark-only (spec §2), so there is no theme provider.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppErrorBoundary>
      <QueryProvider>
        <AuthProvider>{children}</AuthProvider>
      </QueryProvider>
    </AppErrorBoundary>
  )
}
