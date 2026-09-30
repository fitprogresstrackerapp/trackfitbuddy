// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderServiceWorker, shellAssets } from './vite-plugin-service-worker.ts'

describe('service worker build', () => {
  it('precaches the assets the built index.html references', () => {
    const html = `<script type="module" crossorigin src="/assets/index-A.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-B.js">
      <link rel="stylesheet" crossorigin href="/assets/index-C.css">
      <link rel="manifest" href="/manifest.webmanifest" />`
    expect(shellAssets(html)).toEqual([
      '/assets/index-A.js',
      '/assets/vendor-B.js',
      '/assets/index-C.css',
    ])
  })

  it('injects the build id and precache list into the real template', () => {
    const template = readFileSync(
      resolve(import.meta.dirname, '../src/pwa/service-worker.js'),
      'utf8',
    )
    const worker = renderServiceWorker(template, 'abc123', ['/index.html'])
    expect(worker).toContain('const BUILD_ID = "abc123"')
    expect(worker).toContain('const PRECACHE = ["/index.html"]')
    expect(worker).not.toContain('__BUILD_ID__')
    expect(() => renderServiceWorker('nothing to fill', 'x', [])).toThrow(/placeholders/)
  })
})
