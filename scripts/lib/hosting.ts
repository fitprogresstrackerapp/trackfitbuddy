import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The subset of vercel.json this project uses, interpreted the way Vercel does:
 * a file in the output directory wins; otherwise the first matching rewrite
 * applies; header rules apply in order to every matching path (later rules
 * override earlier keys). Sources are path-to-regexp patterns that are also
 * plain regular expressions (e.g. "/(.*)", "/((?!assets/).*)").
 *
 * Used by the local production server (scripts/serve-dist.ts) and by the
 * hosting tests, so both exercise the real deployment configuration.
 */
export interface HostingConfig {
  outputDirectory: string
  rewrites: { source: string; destination: string }[]
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

export function loadHostingConfig(root = process.cwd()): HostingConfig {
  return JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as HostingConfig
}

const matches = (source: string, pathname: string) => new RegExp(`^${source}$`).test(pathname)

/** The output file served for a path, or null for a 404. */
export function resolvePath(
  config: HostingConfig,
  pathname: string,
  fileExists: (path: string) => boolean,
): string | null {
  if (pathname === '/' && fileExists('/index.html')) return '/index.html'
  if (fileExists(pathname)) return pathname
  const rewrite = config.rewrites.find((rule) => matches(rule.source, pathname))
  if (rewrite && fileExists(rewrite.destination)) return rewrite.destination
  return null
}

/** Response headers for a request path (not the rewritten file). */
export function headersFor(config: HostingConfig, pathname: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rule of config.headers) {
    if (!matches(rule.source, pathname)) continue
    for (const { key, value } of rule.headers) result[key] = value
  }
  return result
}

/** Parses a CSP header into directive → sources. */
export function parseCsp(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {}
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) directives[name] = sources
  }
  return directives
}

/**
 * Local testing only: the production CSP allows https://*.supabase.co; a local
 * Supabase stack (http://127.0.0.1:54321) is added to the same directives.
 */
export function withLocalSupabase(policy: string, origin: string): string {
  return policy
    .split(';')
    .map((part) => {
      const trimmed = part.trim()
      return /^(connect-src|img-src)\s/.test(trimmed) ? `${trimmed} ${origin}` : trimmed
    })
    .join('; ')
}
