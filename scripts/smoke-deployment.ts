/**
 * Read-only smoke test of a deployment (docs/deployment.md → After deployment).
 * Uses only public configuration and ONE designated test account (role USER).
 * Creates or changes no data except the test account's own sign-in session.
 *
 *   APP_URL=https://app.example.com \
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon key> \
 *   SMOKE_PHONE=+919876543210 SMOKE_PIN=<pin> \
 *   npm run smoke:deployment
 *
 * The PIN is read from the environment and never printed.
 */
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database.ts'
import { loadHostingConfig } from './lib/hosting.ts'

const required = [
  'APP_URL',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SMOKE_PHONE',
  'SMOKE_PIN',
] as const
const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  console.error(`Missing environment: ${missing.join(', ')}`)
  process.exit(2)
}
const env = Object.fromEntries(required.map((key) => [key, process.env[key] ?? ''])) as Record<
  (typeof required)[number],
  string
>
const APP = env.APP_URL.replace(/\/$/, '')

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  — ${detail}`}`)
}

// 1–2. App, manifest, worker, headers, SPA routes.
const home = await fetch(APP + '/')
const html = await home.text()
check('app loads', home.status === 200 && html.includes('<div id="root">'))
const expectedCsp =
  loadHostingConfig().headers[0]?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ??
  ''
const csp = home.headers.get('content-security-policy') ?? ''
check(
  'security headers are served',
  csp.includes("script-src 'self'") && home.headers.get('x-content-type-options') === 'nosniff',
)
check('CSP matches vercel.json', !APP.startsWith('https://') || csp === expectedCsp, csp)
const manifest = await fetch(APP + '/manifest.webmanifest')
const manifestJson = (await manifest.json().catch(() => ({}))) as {
  name?: string
  icons?: unknown[]
}
check(
  'PWA manifest loads',
  manifest.ok && manifestJson.name === 'TrackFitBuddy' && (manifestJson.icons?.length ?? 0) >= 3,
)
const worker = await fetch(APP + '/sw.js')
check(
  'service worker is served uncached',
  worker.ok && (worker.headers.get('cache-control') ?? '').includes('no-cache'),
)
for (const route of [
  '/login',
  '/food',
  '/groups/00000000-0000-0000-0000-000000000000',
  '/admin/users',
]) {
  const response = await fetch(APP + route)
  check(
    `direct navigation ${route} (no hosting 404)`,
    response.status === 200 && (await response.text()).includes('<div id="root">'),
  )
}
check('missing asset is a 404', (await fetch(APP + '/assets/does-not-exist.js')).status === 404)

// 3–5. Login through the pin-login function, session use, refresh.
const login = await fetch(`${env.SUPABASE_URL}/functions/v1/pin-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY, Origin: APP },
  body: JSON.stringify({ phone: env.SMOKE_PHONE, pin: env.SMOKE_PIN }),
})
// The LOCAL stack's API gateway adds "*" to every function response; hosted
// Supabase does not, so there the function's own allow-list must answer.
const localStack = /^http:\/\/(127\.0\.0\.1|localhost)/.test(env.SUPABASE_URL)
const allowOrigin = login.headers.get('access-control-allow-origin')
check(
  'pin-login allows the app origin (CORS)',
  allowOrigin === APP || (localStack && allowOrigin === '*'),
  `got ${String(allowOrigin)}; set ALLOWED_ORIGINS=${APP} as a function secret`,
)
const session = (await login.json().catch(() => ({}))) as {
  access_token?: string
  refresh_token?: string
}
check(
  'test account signs in',
  login.status === 200 && !!session.access_token,
  `status ${String(login.status)}`,
)
const wrong = await fetch(`${env.SUPABASE_URL}/functions/v1/pin-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: env.SUPABASE_ANON_KEY },
  body: JSON.stringify({ phone: '+910000000000', pin: '0000' }),
})
check(
  'invalid credentials are refused without detail',
  wrong.status === 401 && !/stack|sql|postgres/i.test(await wrong.text()),
)

if (session.access_token && session.refresh_token) {
  const client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  const refreshed = await client.auth.refreshSession()
  check('session refresh works', !refreshed.error && !!refreshed.data.session)
  const user = (await client.auth.getUser()).data.user
  const profile = await client
    .from('profiles')
    .select('id, is_active')
    .eq('id', user?.id ?? '')
    .single()
  check('own data is readable', !profile.error && profile.data.is_active)
  const others = await client
    .from('profiles')
    .select('id')
    .neq('id', user?.id ?? '')
  check('other users’ profiles are not readable', (others.data ?? []).length === 0)
  const adminRead = await client.rpc('admin_list_users', {})
  check('admin functions refuse a normal user', adminRead.error?.code === '42501')
  const audit = await client
    .from('audit_logs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  check('audit log cannot be modified', !!audit.error || (audit.count ?? 0) === 0)
  const processing = await fetch(`${env.SUPABASE_URL}/functions/v1/process-recommendations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${refreshed.data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ action: 'continue' }),
  })
  check('AI processing refuses a normal user', processing.status === 403)
  const listed = await client.storage.from('inbody-reports').list('')
  check(
    'InBody bucket lists nothing outside the own folder',
    (listed.data ?? []).every((f) => f.name === user?.id),
  )
  await client.auth.signOut()
  const afterLogout = await client
    .from('profiles')
    .select('id')
    .eq('id', user?.id ?? '')
  check('logout ends access', (afterLogout.data ?? []).length === 0)
}

// Anonymous access.
const anon = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})
check(
  'anonymous users read no profiles',
  ((await anon.from('profiles').select('id')).data ?? []).length === 0,
)
const bucket = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/inbody-reports/x.pdf`)
check('InBody bucket is not public', !bucket.ok)
const signup = await anon.auth.signUp({
  email: `smoke-${String(Date.now())}@example.invalid`,
  password: 'not-used-123456',
})
check('public sign-up is disabled', !!signup.error)

console.log(
  failures === 0 ? '\nSmoke test passed.' : `\n✖ ${String(failures)} smoke check(s) failed.`,
)
process.exitCode = failures === 0 ? 0 : 1
