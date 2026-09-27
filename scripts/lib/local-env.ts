import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ServerEnv {
  supabaseUrl: string
  anonKey: string
  serviceRoleKey: string
  pinAuthSecret: string
}

function parseDotenv(text: string): Partial<Record<string, string>> {
  const values: Partial<Record<string, string>> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line)
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2]
  }
  return values
}

/**
 * Server credentials for the LOCAL Supabase stack: read from `supabase status`
 * and `supabase/functions/.env`. Never used for the browser build.
 */
export function readLocalServerEnv(projectRoot = process.cwd()): ServerEnv {
  const status = parseDotenv(
    execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    }),
  )
  const functionsEnv = parseDotenv(
    readFileSync(resolve(projectRoot, 'supabase/functions/.env'), 'utf8'),
  )

  const env: ServerEnv = {
    supabaseUrl: status.API_URL ?? '',
    anonKey: status.ANON_KEY ?? '',
    serviceRoleKey: status.SERVICE_ROLE_KEY ?? '',
    pinAuthSecret: functionsEnv.PIN_AUTH_SECRET ?? '',
  }
  if (!env.supabaseUrl || !env.anonKey || !env.serviceRoleKey || !env.pinAuthSecret) {
    throw new Error(
      'Local Supabase is not running or supabase/functions/.env is missing PIN_AUTH_SECRET',
    )
  }
  return env
}

/** Server credentials from process environment (for a hosted project). */
export function readProcessServerEnv(): ServerEnv {
  const env: ServerEnv = {
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    anonKey: process.env.SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    pinAuthSecret: process.env.PIN_AUTH_SECRET ?? '',
  }
  if (!env.supabaseUrl || !env.serviceRoleKey || !env.pinAuthSecret) {
    throw new Error(
      'Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and PIN_AUTH_SECRET (or pass --local)',
    )
  }
  return env
}
