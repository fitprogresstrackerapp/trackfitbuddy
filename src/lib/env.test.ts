import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
})

async function loadEnv(values: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value)
  return import('./env')
}

describe('public environment', () => {
  it('accepts the Supabase URL and anon key', async () => {
    const { getPublicEnv } = await loadEnv({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(getPublicEnv()).toEqual({
      VITE_SUPABASE_URL: 'https://abc.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
    })
  })

  it('missing configuration fails with a message naming what to set', async () => {
    const { getPublicEnv, EnvConfigError } = await loadEnv({
      VITE_SUPABASE_URL: 'not a url',
      VITE_SUPABASE_ANON_KEY: '',
    })
    expect(() => getPublicEnv()).toThrow(EnvConfigError)
    expect(() => getPublicEnv()).toThrow(/VITE_SUPABASE_URL must be a valid URL/)
    expect(() => getPublicEnv()).toThrow(/VITE_SUPABASE_ANON_KEY is required/)
  })
})
