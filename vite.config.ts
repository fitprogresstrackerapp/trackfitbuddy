import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
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
})
