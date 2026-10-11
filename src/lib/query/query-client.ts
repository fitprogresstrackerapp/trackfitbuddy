import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
        // Always attempt a save. The default ("online") pauses a mutation while
        // the browser reports it is offline: the form would sit on "Saving…"
        // with no explanation, and the entry would be lost if the app is
        // closed. Attempted offline, it fails at once with a connection error
        // the user can see and retry.
        networkMode: 'always',
      },
    },
  })
}
