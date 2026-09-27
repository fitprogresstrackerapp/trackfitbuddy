import { z } from 'zod'

/**
 * Public (browser-safe) environment configuration.
 *
 * Only `VITE_`-prefixed variables reach the client bundle, so nothing secret may
 * live here. Service-role keys and AI provider keys belong to Edge Functions only.
 */
const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.url({ error: 'VITE_SUPABASE_URL must be a valid URL' }),
  VITE_SUPABASE_ANON_KEY: z.string().min(1, { error: 'VITE_SUPABASE_ANON_KEY is required' }),
})

export type PublicEnv = z.infer<typeof publicEnvSchema>

export class EnvConfigError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n- ${issues.join('\n- ')}\n` +
        'Copy .env.example to .env and fill in your Supabase project values.',
    )
    this.name = 'EnvConfigError'
  }
}

let cached: PublicEnv | undefined

/** Validates and returns the public env. Throws `EnvConfigError` when misconfigured. */
export function getPublicEnv(): PublicEnv {
  if (cached) return cached

  const result = publicEnvSchema.safeParse(import.meta.env)
  if (!result.success) {
    throw new EnvConfigError(result.error.issues.map((issue) => issue.message))
  }

  cached = result.data
  return cached
}
