import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getPublicEnv } from '@/lib/env'

let client: SupabaseClient | undefined

/**
 * Browser Supabase client (anon key; all access is governed by RLS).
 *
 * Created lazily so the app shell can render before Supabase is configured;
 * the first data/auth call throws a descriptive `EnvConfigError` instead.
 * Database types will be added once the schema migrations exist.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client

  const env = getPublicEnv()
  client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return client
}
