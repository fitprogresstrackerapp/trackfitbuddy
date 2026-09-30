import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import type { Plugin } from 'vite'

const TEMPLATE = resolve(import.meta.dirname, '../src/pwa/service-worker.js')

function listPublic(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory()
      ? listPublic(path, root)
      : ['/' + relative(root, path).split('\\').join('/')]
  })
}

/** Local /assets/* files referenced by the built index.html (entry JS, CSS, preloads). */
export function shellAssets(html: string): string[] {
  return [
    ...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] ?? '')),
  ]
}

/** Fills the service worker template with this build's id and precache list. */
export function renderServiceWorker(template: string, buildId: string, precache: string[]): string {
  if (!template.includes("'__BUILD_ID__'") || !template.includes("['__PRECACHE__']")) {
    throw new Error('service-worker.js template placeholders are missing')
  }
  return template
    .replace("'__BUILD_ID__'", JSON.stringify(buildId))
    .replace("['__PRECACHE__']", JSON.stringify(precache))
}

/**
 * Emits /sw.js for production builds. Precache: the app shell (index.html and
 * the assets it references) and the public manifest/icons. The build id is a
 * hash of every emitted file name (content-hashed) and the public files, so each
 * deployment gets a new worker and a new cache.
 */
export function serviceWorkerPlugin(): Plugin {
  let publicDir = ''
  return {
    name: 'trackfitbuddy:service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (html?.type !== 'asset') throw new Error('index.html missing from the bundle')
      const publicFiles = publicDir ? listPublic(publicDir) : []
      const precache = [
        '/index.html',
        ...shellAssets(String(html.source)),
        ...publicFiles.filter((path) => /\.(webmanifest|png|svg)$/.test(path)),
      ]
      const hash = createHash('sha256')
      for (const name of Object.keys(bundle).sort()) hash.update(name)
      hash.update(String(html.source))
      for (const path of publicFiles) hash.update(path).update(readFileSync(join(publicDir, path)))
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(
          readFileSync(TEMPLATE, 'utf8'),
          hash.digest('hex').slice(0, 16),
          precache,
        ),
      })
    },
  }
}
