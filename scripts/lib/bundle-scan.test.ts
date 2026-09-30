// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { forbiddenFile, scanBundleText } from './bundle-scan.ts'
import { publicEnvProblems } from './public-env-guard.ts'

const jwt = (role: string) =>
  [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(JSON.stringify({ role })).toString('base64url'),
    'signature',
  ].join('.')

describe('bundle secret scan', () => {
  it('passes ordinary app code with the anon key', () => {
    const code = `const url="https://abc.supabase.co";const key="${jwt('anon')}";fetch(url+"/functions/v1/pin-login")`
    expect(scanBundleText('app.js', code)).toEqual([])
  })

  it.each([
    ['a service-role JWT', `k="${jwt('service_role')}"`, 'JWT with role "service_role"'],
    ['a Supabase secret key', 'k="sb_secret_abcdefghijklmnopqrstuv"', 'Supabase secret API key'],
    ['an Anthropic key', `k="sk-ant-api03-${'x'.repeat(40)}"`, 'AI provider API key'],
    ['a server env name', 'process.env.PIN_AUTH_SECRET', '"PIN_AUTH_SECRET"'],
    [
      'a connection string',
      'u="postgresql://postgres:hunter22@db.abc.supabase.co:5432/postgres"',
      'connection string',
    ],
    ['Edge Function code', 'Deno.env.get("X")', 'Edge Function code'],
    [
      'the AI prompt',
      'You write the monthly nutrition and training recommendation for one user',
      'the AI prompt',
    ],
    ['the mock provider', 'model:"mock-recommender-1"', 'mock AI provider'],
  ])('fails on %s', (_name, text, expected) => {
    const findings = scanBundleText('leak.js', text)
    expect(findings.join('\n')).toContain(expected)
  })

  it('fails on a known secret value, whatever its shape', () => {
    expect(
      scanBundleText('a.js', 'x="local-pin-secret-value-123"', ['local-pin-secret-value-123']),
    ).toEqual(['a.js: contains a server secret value'])
  })

  it('source maps and env files may not be published', () => {
    expect(forbiddenFile('dist/assets/index.js.map')).toMatch(/source map/)
    expect(forbiddenFile('dist/.env.production')).toMatch(/environment file/)
    expect(forbiddenFile('dist/assets/index.js')).toBeNull()
  })
})

describe('public env guard', () => {
  it('accepts the Supabase URL and anon key', () => {
    expect(
      publicEnvProblems({
        VITE_SUPABASE_URL: 'https://abc.supabase.co',
        VITE_SUPABASE_ANON_KEY: jwt('anon'),
        SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'), // not VITE_: never bundled
      }),
    ).toEqual([])
  })

  it('rejects secrets given a VITE_ name or put in a public variable', () => {
    expect(
      publicEnvProblems({
        VITE_SUPABASE_SERVICE_ROLE_KEY: 'x',
        VITE_ANTHROPIC_API_KEY: 'x',
        VITE_FEATURE_FLAG: 'on',
        VITE_SUPABASE_ANON_KEY: jwt('service_role'),
      }),
    ).toEqual([
      'VITE_SUPABASE_SERVICE_ROLE_KEY looks like a server secret',
      'VITE_ANTHROPIC_API_KEY looks like a server secret',
      'VITE_FEATURE_FLAG is not a known public variable',
      'VITE_SUPABASE_ANON_KEY is a JWT with role "service_role"',
    ])
    expect(publicEnvProblems({ VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' })).toEqual([
      'VITE_SUPABASE_ANON_KEY contains a secret-looking value',
    ])
  })
})
