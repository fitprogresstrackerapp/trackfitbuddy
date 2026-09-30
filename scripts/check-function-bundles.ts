/**
 * Proves every Edge Function is deployable as a self-contained bundle,
 * including the modules it shares with the app (src/, scripts/lib/).
 *
 *   npm run functions:bundle          (requires Docker)
 *
 * 1. Bundles each function with the Supabase edge-runtime image — the same
 *    bundler `supabase functions deploy` uses — with the project root mounted,
 *    exactly like the CLI.
 * 2. Starts each bundle in a container that contains ONLY the bundle (no
 *    project source) and checks that it boots and answers: a CORS preflight
 *    from an allowed origin, and an unauthenticated request (refused, with no
 *    internals in the body). No database or real secrets are involved.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const IMAGE = process.env.EDGE_RUNTIME_IMAGE ?? 'public.ecr.aws/supabase/edge-runtime:v1.76.2'
const ROOT = resolve(import.meta.dirname, '..')
const FUNCTIONS = join(ROOT, 'supabase', 'functions')
const ORIGIN = 'http://localhost:5173'
const SUPABASE_URL = 'http://127.0.0.1:1' // unreachable: the probes never get that far

const docker = (args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  })

// Every function expects this shape for an unauthenticated or empty request.
const UNAUTHENTICATED: Record<string, { body: unknown; status: number }> = {
  'pin-login': { body: {}, status: 400 },
  'admin-users': { body: { action: 'reset_pin' }, status: 401 },
  'process-recommendations': { body: { action: 'continue' }, status: 401 },
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fetch(url, { method: 'OPTIONS' })
      return
    } catch {
      await new Promise((done) => setTimeout(done, 500))
    }
  }
  throw new Error(`${url} did not start`)
}

const names = readdirSync(FUNCTIONS).filter(
  (name) => !name.startsWith('_') && statSync(join(FUNCTIONS, name)).isDirectory(),
)
const out = mkdtempSync(join(tmpdir(), 'tfb-bundles-'))
const failures: string[] = []
let port = 9300

try {
  for (const name of names) {
    const entry = `/project/supabase/functions/${name}/index.ts`
    try {
      docker([
        'run',
        '--rm',
        '-v',
        `${ROOT}:/project:ro`,
        '-v',
        `${out}:/out`,
        '-w',
        `/project/supabase/functions/${name}`,
        IMAGE,
        'bundle',
        '--entrypoint',
        entry,
        '--output',
        `/out/${name}.eszip`,
      ])
    } catch (error) {
      failures.push(`${name}: bundling failed\n${(error as { stderr?: string }).stderr ?? ''}`)
      continue
    }
    const size = statSync(join(out, `${name}.eszip`)).size
    port += 1
    const container = `tfb-bundle-check-${name}`
    docker(['rm', '-f', container])
    docker([
      'run',
      '-d',
      '--name',
      container,
      '-p',
      `${String(port)}:9000`,
      '-v',
      `${out}:/bundle:ro`,
      '-e',
      `SUPABASE_URL=${SUPABASE_URL}`,
      '-e',
      'SUPABASE_ANON_KEY=bundle-check',
      '-e',
      'SUPABASE_SERVICE_ROLE_KEY=bundle-check',
      '-e',
      'PIN_AUTH_SECRET=bundle-check-secret-bundle-check-secret',
      '-e',
      'AI_PROVIDER=mock',
      IMAGE,
      'start',
      '--main-service',
      `/bundle/${name}.eszip`,
      '--main-entrypoint',
      `file://${entry}`,
    ])
    try {
      const url = `http://localhost:${String(port)}/`
      await waitForServer(url)
      const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: ORIGIN } })
      const allowed = preflight.headers.get('access-control-allow-origin')
      const foreign = await fetch(url, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example' },
      })
      const probe = UNAUTHENTICATED[name]
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify(probe?.body ?? {}),
      })
      const text = await response.text()
      const problems = [
        allowed === ORIGIN ? null : `preflight did not allow ${ORIGIN} (${String(allowed)})`,
        foreign.headers.get('access-control-allow-origin') ? 'an unknown origin was allowed' : null,
        foreign.headers.get('access-control-allow-origin') === '*' ? 'wildcard CORS' : null,
        probe && response.status !== probe.status
          ? `unauthenticated request → ${String(response.status)}, expected ${String(probe.status)}`
          : null,
        /stack|at file:|\/project\/|postgres|service_role/i.test(text)
          ? `internals in response: ${text}`
          : null,
      ].filter((problem): problem is string => problem !== null)
      if (problems.length > 0) failures.push(`${name}: ${problems.join('; ')}`)
      else
        console.log(`ok  ${name}  (bundle ${(size / 1024 / 1024).toFixed(1)} MB, boots standalone)`)
    } finally {
      docker(['rm', '-f', container])
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n✖ Edge Function bundle check FAILED:\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`\nAll ${String(names.length)} Edge Functions bundle and run standalone.`)
}
