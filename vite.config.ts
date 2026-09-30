import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { publicEnvProblems } from './scripts/lib/public-env-guard.ts'
import { serviceWorkerPlugin } from './scripts/vite-plugin-service-worker.ts'

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    // Only browser-safe VITE_ variables may reach the bundle (docs/deployment.md).
    const problems = publicEnvProblems({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env })
    if (problems.length > 0) {
      throw new Error(`Unsafe public environment:\n- ${problems.join('\n- ')}`)
    }
  }

  return {
    plugins: [react(), tailwindcss(), serviceWorkerPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    build: {
      // No source maps in production: nothing beyond the minified bundle is published.
      sourcemap: false,
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks: cached across app releases and kept under
          // the chunk-size budget. Higher priority groups claim modules first.
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
                priority: 30,
              },
              { name: 'vendor-supabase', test: /node_modules[\\/]@supabase[\\/]/, priority: 20 },
              // Zod with its configuration (jitless, for the CSP): every module that
              // builds a schema imports this chunk, so the config always runs first.
              {
                name: 'vendor-zod',
                test: /node_modules[\\/]zod[\\/]|src[\\/]lib[\\/]validation[\\/]zod-config\.ts$/,
                priority: 25,
              },
              // Everything else shared — except the charting stack, which only the
              // lazily loaded Progress page uses and so stays in its lazy chunk.
              {
                name: 'vendor',
                test: /node_modules[\\/](?!(recharts|d3-[^\\/]+|victory-vendor|decimal\.js-light|internmap|es-toolkit|immer|reselect|@reduxjs|redux|react-redux|redux-thunk|eventemitter3)[\\/])/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
  }
})
