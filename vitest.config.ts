import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

/**
 * Unit and component tests (jsdom). Integration tests: vitest.integration.config.ts
 * `scripts/**` tests cover build, hosting and deployment tooling.
 */
export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: 'jsdom',
        setupFiles: ['src/test/setup.ts'],
        // Page tests cold-load lazy routes; on a cold transform cache (fresh
        // checkout, CI) the first test of a file can take several seconds.
        testTimeout: 30_000,
        include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        restoreMocks: true,
        unstubEnvs: true,
      },
    }),
  ),
)
