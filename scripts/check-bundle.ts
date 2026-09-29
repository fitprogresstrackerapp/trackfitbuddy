/**
 * Fails if the production bundle (dist/) contains server-only secrets:
 * service-role JWTs, secret API keys (Supabase and AI providers), or the names/values of
 * server secrets.
 * Run after `npm run build`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { readLocalServerEnv } from './lib/local-env.ts'

const DIST = 'dist'
const JWT = /eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g
const FORBIDDEN_MARKERS = [
  'SERVICE_ROLE',
  'service_role_key',
  'PIN_AUTH_SECRET',
  // AI provider secrets and server-only provider code (Prompt 10).
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'x-api-key',
]
// A real secret API key. (supabase-js itself contains the bare `sb_secret_` prefix
// in a key-type check, which is not a secret.)
const SECRET_API_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/
// Anthropic / OpenAI-style secret keys.
const AI_API_KEY = /sk-(ant-)?[A-Za-z0-9_-]{32,}/

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

function jwtRole(payloadSegment: string): string | null {
  try {
    const payload: unknown = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
    return typeof payload === 'object' &&
      payload !== null &&
      'role' in payload &&
      typeof payload.role === 'string'
      ? payload.role
      : null
  } catch {
    return null
  }
}

const secretValues: string[] = []
try {
  const env = readLocalServerEnv()
  secretValues.push(env.serviceRoleKey, env.pinAuthSecret)
  const aiKey = /^ANTHROPIC_API_KEY=(.+)$/m.exec(
    readFileSync('supabase/functions/.env', 'utf8'),
  )?.[1]
  if (aiKey) secretValues.push(aiKey.trim())
} catch {
  // Local stack not running: marker and JWT checks still apply.
}

const findings: string[] = []
const files = listFiles(DIST).filter((file) => /\.(js|html|css|map|json|txt)$/.test(file))

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const marker of FORBIDDEN_MARKERS) {
    if (text.includes(marker)) findings.push(`${file}: contains "${marker}"`)
  }
  if (SECRET_API_KEY.test(text)) findings.push(`${file}: contains a secret API key`)
  if (AI_API_KEY.test(text)) findings.push(`${file}: contains an AI provider API key`)
  for (const value of secretValues) {
    if (value && text.includes(value)) findings.push(`${file}: contains a server secret value`)
  }
  for (const match of text.matchAll(JWT)) {
    const role = match[1] ? jwtRole(match[1]) : null
    if (role && role !== 'anon') findings.push(`${file}: contains a JWT with role "${role}"`)
  }
}

if (findings.length > 0) {
  console.error(`Bundle secret check FAILED:\n${findings.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Bundle secret check passed (${files.length} files scanned).`)
}
