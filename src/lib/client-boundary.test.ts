// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * Browser code (src/) must not reference server-only configuration or import
 * server-only modules. The recommendation engine under src/ is shared with the
 * Edge Function but is pure: its secrets and providers live in
 * supabase/functions/.
 */

const SRC = resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })
}

const FORBIDDEN: [RegExp, string][] = [
  [/SERVICE_ROLE/, 'a service-role key'],
  [/PIN_AUTH_SECRET/, 'the PIN secret'],
  [/ANTHROPIC_API_KEY|OPENAI_API_KEY/, 'an AI provider key'],
  [/\bDeno\.env\b/, 'Edge Function environment'],
  [/\bprocess\.env\b/, 'Node environment'],
  [
    /import\.meta\.env\.(?!VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|DEV\b|PROD\b|MODE\b)\w+/,
    'a non-public env value',
  ],
  [/from ['"][./]*(?:\.\.\/)+(?:supabase|scripts|tests)\//, 'server/tooling/test modules'],
  [/from ['"]@anthropic-ai\/sdk['"]/, 'the AI provider SDK'],
]

describe('client code boundary', () => {
  it('src/ never reads server-only variables or imports server-only code', () => {
    const violations = sourceFiles(SRC)
      .filter((file) => !file.endsWith('service-worker.js'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8')
        return FORBIDDEN.filter(([pattern]) => pattern.test(text)).map(
          ([, what]) => `${relative(SRC, file)} references ${what}`,
        )
      })
    expect(violations).toEqual([])
  })

  it('the only env access goes through the validated public env module', () => {
    const readers = sourceFiles(SRC)
      .filter((file) => /import\.meta\.env(?!\.(DEV|PROD)\b)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
    expect(readers).toEqual(['lib/env.ts'])
  })
})
