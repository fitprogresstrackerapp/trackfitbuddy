import { defineConfig } from 'vitest/config'

/**
 * Integration tests against the LOCAL Supabase stack (`npm run supabase:start`
 * must be running). Uses the service role; helpers refuse non-local URLs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
