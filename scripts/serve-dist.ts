/**
 * Serves the production build (dist/) the way Vercel will: files first, then
 * the SPA rewrite, with the security and cache headers from vercel.json.
 * For local verification of routing, CSP and the service worker:
 *
 *   npm run build && npm run preview:prod        # http://localhost:4173
 *
 * The only difference from production: the local Supabase origin (from
 * VITE_SUPABASE_URL when it is not https) is added to connect-src and img-src.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

import { loadEnv } from 'vite'

import { headersFor, loadHostingConfig, resolvePath, withLocalSupabase } from './lib/hosting.ts'

const PORT = Number(process.env.PORT ?? 4173)
const config = loadHostingConfig()
const root = normalize(join(process.cwd(), config.outputDirectory))

const supabaseUrl = loadEnv('production', process.cwd(), 'VITE_').VITE_SUPABASE_URL ?? ''
const localSupabase = supabaseUrl.startsWith('http://') ? new URL(supabaseUrl).origin : null

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

const fileExists = (path: string) => {
  const full = normalize(join(root, path))
  return full.startsWith(root) && existsSync(full) && statSync(full).isFile()
}

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const file = resolvePath(config, pathname, fileExists)
  const headers = headersFor(config, pathname)
  const csp = headers['Content-Security-Policy']
  if (csp && localSupabase)
    headers['Content-Security-Policy'] = withLocalSupabase(csp, localSupabase)
  if (!file) {
    response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found')
    return
  }
  response
    .writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      ...headers,
    })
    .end(request.method === 'HEAD' ? undefined : readFileSync(join(root, file)))
}).listen(PORT, () => {
  console.log(
    `Serving ${config.outputDirectory}/ with vercel.json rules on http://localhost:${String(PORT)}`,
  )
})
