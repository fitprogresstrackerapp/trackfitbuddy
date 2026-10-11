/**
 * True when a request never reached the server (offline, DNS, dropped
 * connection). `fetch` rejects with a TypeError, but supabase-js catches it
 * and returns a plain error object whose message is the browser's wording
 * ("TypeError: Failed to fetch", "Load failed", "NetworkError when…"); the
 * Functions client reports "Failed to send a request to the Edge Function".
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const message =
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  return /failed to fetch|fetch failed|load failed|networkerror|network request failed|failed to send a request|err_internet_disconnected/i.test(
    message,
  )
}

export const NETWORK_ERROR_MESSAGE =
  'Couldn’t reach the server. Check your connection and try again.'
