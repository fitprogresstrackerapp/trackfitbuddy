/**
 * Fails loudly if the production output (dist/) contains server-only secrets or
 * code: service-role/secret keys, AI provider keys, PIN secret, connection
 * strings, server env names, Edge Function / AI prompt / mock-provider code,
 * source maps or env files. Also rejects unsafe VITE_ variables.
 * Run after `npm run build` (Vercel runs it as part of the build command).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { loadEnv } from 'vite'

import { forbiddenFile, scanBundleText } from './lib/bundle-scan.ts'
import { readLocalServerEnv } from './lib/local-env.ts'
import { publicEnvProblems } from './lib/public-env-guard.ts'

const DIST = 'dist'
const BINARY = /\.(png|jpe?g|webp|ico|woff2?)$/i
const SERVER_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE_KEY',
  'PIN_AUTH_SECRET',
  'ANTHROPIC_API_KEY',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
]

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

// Actual secret values known to this machine / build environment.
const secretValues = SERVER_ENV_NAMES.map((name) => process.env[name] ?? '').filter(Boolean)
if (!process.env.CI && !process.env.VERCEL) {
  try {
    const env = readLocalServerEnv()
    secretValues.push(env.serviceRoleKey, env.pinAuthSecret)
    const aiKey = /^ANTHROPIC_API_KEY=(.+)$/m.exec(
      readFileSync('supabase/functions/.env', 'utf8'),
    )?.[1]
    if (aiKey) secretValues.push(aiKey.trim())
  } catch {
    // Local stack not running: pattern checks still apply.
  }
}

const findings = publicEnvProblems({
  ...loadEnv('production', process.cwd(), 'VITE_'),
  ...process.env,
}).map((problem) => `environment: ${problem}`)

const files = listFiles(DIST)
for (const file of files) {
  const forbidden = forbiddenFile(file)
  if (forbidden) findings.push(forbidden)
  if (BINARY.test(file)) continue
  findings.push(...scanBundleText(file, readFileSync(file, 'utf8'), secretValues))
}

if (findings.length > 0) {
  console.error(
    `\n✖ Bundle secret check FAILED (${String(findings.length)}):\n- ${findings.join('\n- ')}\n`,
  )
  process.exitCode = 1
} else {
  console.log(`Bundle secret check passed (${String(files.length)} files scanned).`)
}
