import { EnvConfigError } from '@/lib/env'

export interface UnexpectedErrorView {
  title: string
  description: string
  /** Reloading is the fix (e.g. the app was updated while it was open). */
  reload: boolean
}

// Browsers word a failed lazy-chunk load differently.
const CHUNK_LOAD =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

/**
 * What an unexpected (non-domain) error screen may show. Production never
 * shows raw messages, which can carry internals; development shows them.
 */
export function describeUnexpectedError(
  error: unknown,
  dev: boolean = import.meta.env.DEV,
): UnexpectedErrorView {
  const message = error instanceof Error ? error.message : ''
  if (CHUNK_LOAD.test(message)) {
    return {
      title: 'New version available',
      description: 'TrackFitBuddy was updated. Reload to continue.',
      reload: true,
    }
  }
  // Operator-facing and free of secrets: tells the deployer what to set.
  if (error instanceof EnvConfigError) {
    return { title: 'App not configured', description: error.message, reload: false }
  }
  return {
    title: 'Something went wrong',
    description:
      dev && message ? message : 'Reload the page. If this keeps happening, try again later.',
    reload: true,
  }
}
