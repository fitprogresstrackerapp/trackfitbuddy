import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getPublicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

export type AppSupabaseClient = SupabaseClient<Database>

let client: AppSupabaseClient | undefined

/**
 * Browser Supabase client (anon key; all access is governed by RLS).
 *
 * Created lazily so the app shell can render before Supabase is configured;
 * the first data/auth call throws a descriptive `EnvConfigError` instead.
 * Types come from `src/types/database.ts` (regenerate with `npm run db:types`).
 */
export function getSupabaseClient(): AppSupabaseClient {
  if (client) return client

  const env = getPublicEnv()
  client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return client
}
