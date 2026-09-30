/**
 * Browser-safe configuration: the only VITE_ variables the app may read. Vite
 * inlines every referenced `import.meta.env.VITE_*` value into the public
 * bundle, so anything else — above all a server secret given a VITE_ name by
 * mistake — must stop the build.
 */
export const PUBLIC_ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

const SECRET_NAME =
  /SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN|ANTHROPIC|OPENAI|PIN_AUTH|DATABASE|DB_URL/i
const SECRET_VALUE = /sb_secret_|sk-(ant-)?[A-Za-z0-9_-]{20,}|postgres(ql)?:\/\//i

function jwtRole(value: string): string | null {
  const payload = value.split('.')[1]
  if (!payload) return null
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof decoded === 'object' && decoded !== null && 'role' in decoded
      ? String(decoded.role)
      : null
  } catch {
    return null
  }
}

/** Problems with the VITE_ variables a build would see; empty when safe. */
export function publicEnvProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = []
  for (const [key, value = ''] of Object.entries(env)) {
    if (!key.startsWith('VITE_')) continue
    if (!(PUBLIC_ENV_KEYS as readonly string[]).includes(key)) {
      if (SECRET_NAME.test(key)) problems.push(`${key} looks like a server secret`)
      else problems.push(`${key} is not a known public variable`)
      continue
    }
    if (SECRET_VALUE.test(value)) problems.push(`${key} contains a secret-looking value`)
    const role = value.startsWith('eyJ') ? jwtRole(value) : null
    if (role && role !== 'anon') problems.push(`${key} is a JWT with role "${role}"`)
  }
  return problems
}
