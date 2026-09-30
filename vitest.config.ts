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
        include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
        restoreMocks: true,
        unstubEnvs: true,
      },
    }),
  ),
)
