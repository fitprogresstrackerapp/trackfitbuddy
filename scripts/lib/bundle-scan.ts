/**
 * Patterns that must never appear in the public production bundle (dist/).
 * Used by scripts/check-bundle.ts; unit-tested in bundle-scan.test.ts.
 */

const JWT = /eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g

/** Names of server-only variables and header names of provider credentials. */
const SECRET_NAMES = [
  'SERVICE_ROLE',
  'service_role_key',
  'PIN_AUTH_SECRET',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
  'x-api-key',
]

/** Code that belongs to Edge Functions, provisioning tooling or tests only. */
const SERVER_CODE = [
  { marker: 'Deno.env', what: 'Edge Function code' },
  { marker: 'You write the monthly nutrition and training recommendation', what: 'the AI prompt' },
  { marker: 'mock-recommender', what: 'the mock AI provider' },
  { marker: 'api.anthropic.com', what: 'the AI provider client' },
  { marker: 'auth.admin.createUser', what: 'service-role provisioning code' },
]

const SECRET_API_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/ // supabase-js contains the bare prefix
const AI_API_KEY = /sk-(ant-)?[A-Za-z0-9_-]{32,}/
const CONNECTION_STRING = /postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/

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

/** Findings for one bundle file; empty when clean. */
export function scanBundleText(file: string, text: string, secretValues: string[] = []): string[] {
  const findings: string[] = []
  for (const name of SECRET_NAMES) {
    if (text.includes(name)) findings.push(`${file}: contains "${name}"`)
  }
  for (const { marker, what } of SERVER_CODE) {
    if (text.includes(marker)) findings.push(`${file}: contains ${what} ("${marker}")`)
  }
  if (SECRET_API_KEY.test(text)) findings.push(`${file}: contains a Supabase secret API key`)
  if (AI_API_KEY.test(text)) findings.push(`${file}: contains an AI provider API key`)
  if (CONNECTION_STRING.test(text)) findings.push(`${file}: contains a database connection string`)
  for (const value of secretValues) {
    if (value.length >= 8 && text.includes(value)) {
      findings.push(`${file}: contains a server secret value`)
    }
  }
  for (const match of text.matchAll(JWT)) {
    const role = match[1] ? jwtRole(match[1]) : null
    if (role && role !== 'anon') findings.push(`${file}: contains a JWT with role "${role}"`)
  }
  return findings
}

/** Build output files that must not be published at all. */
export function forbiddenFile(file: string): string | null {
  if (file.endsWith('.map')) return `${file}: source map in the production output`
  if (/(^|[\\/])\.env/.test(file)) return `${file}: environment file in the production output`
  return null
}
