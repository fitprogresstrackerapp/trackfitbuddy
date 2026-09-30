// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  headersFor,
  loadHostingConfig,
  parseCsp,
  resolvePath,
  withLocalSupabase,
} from './hosting.ts'

const config = loadHostingConfig()
const FILES = new Set([
  '/index.html',
  '/sw.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/assets/index-abc.js',
])
const serve = (path: string) => resolvePath(config, path, (file) => FILES.has(file))

const SPA_ROUTES = [
  '/',
  '/login',
  '/onboarding',
  '/food',
  '/workout',
  '/progress',
  '/profile',
  '/groups',
  '/groups/7d4f0c8e-4a51-4f5e-9d1e-6c3b2a1f0e9d',
  '/admin',
  '/admin/users',
  '/admin/users/7d4f0c8e-4a51-4f5e-9d1e-6c3b2a1f0e9d',
  '/admin/audit',
  '/admin/recommendations',
  '/does-not-exist', // the app's own 404 page, not a hosting 404
]

describe('production routing (vercel.json)', () => {
  it.each(SPA_ROUTES)('direct navigation to %s serves the app shell', (route) => {
    expect(serve(route)).toBe('/index.html')
  })

  it('serves real files as themselves', () => {
    expect(serve('/sw.js')).toBe('/sw.js')
    expect(serve('/manifest.webmanifest')).toBe('/manifest.webmanifest')
    expect(serve('/assets/index-abc.js')).toBe('/assets/index-abc.js')
  })

  it('a missing build asset is a real 404, never HTML with 200', () => {
    expect(serve('/assets/old-chunk-123.js')).toBeNull()
  })
})

describe('security headers', () => {
  const pageHeaders = headersFor(config, '/admin/users/abc')
  const csp = parseCsp(pageHeaders['Content-Security-Policy'] ?? '')

  it('every page gets the security headers', () => {
    for (const path of ['/', '/login', '/admin/audit', '/sw.js', '/assets/index-abc.js']) {
      const headers = headersFor(config, path)
      expect(headers['Content-Security-Policy']).toBeTruthy()
      expect(headers).toMatchObject({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      })
      expect(headers['Strict-Transport-Security']).toMatch(/max-age=\d{8,}/)
      expect(headers['Permissions-Policy']).toContain('camera=()')
    }
  })

  it('the CSP allows only this origin’s scripts and Supabase connections', () => {
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['connect-src']).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['worker-src']).toEqual(["'self'"])
    expect(csp['manifest-src']).toEqual(["'self'"])
    const all = Object.values(csp).flat()
    expect(all).not.toContain("'unsafe-eval'")
    expect(all).not.toContain('*')
    expect(csp['script-src']).not.toContain("'unsafe-inline'")
  })

  it('cache rules: hashed assets immutable; shell, worker and manifest revalidate', () => {
    expect(headersFor(config, '/assets/index-abc.js')['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    )
    for (const path of ['/', '/food', '/index.html', '/sw.js', '/manifest.webmanifest']) {
      expect(headersFor(config, path)['Cache-Control'], path).toBe('no-cache')
    }
    expect(headersFor(config, '/manifest.webmanifest')['Content-Type']).toBe(
      'application/manifest+json',
    )
  })

  it('local testing adds only the local Supabase origin to connect-src and img-src', () => {
    const local = parseCsp(
      withLocalSupabase(pageHeaders['Content-Security-Policy'] ?? '', 'http://127.0.0.1:54321'),
    )
    expect(local['connect-src']).toContain('http://127.0.0.1:54321')
    expect(local['img-src']).toContain('http://127.0.0.1:54321')
    expect(local['script-src']).toEqual(["'self'"])
  })
})
