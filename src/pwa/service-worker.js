/*
 * TrackFitBuddy service worker (classic script). The build (vite.config.ts,
 * scripts/vite-plugin-service-worker.ts) injects BUILD_ID and PRECACHE and emits
 * it as /sw.js. It is not used in development.
 *
 * Privacy rule (spec §81, docs/deployment.md): only public, static files from
 * this origin are ever cached:
 *   - PRECACHE: the app shell (index.html), its entry JS/CSS, manifest, icons;
 *   - /assets/*: content-hashed build files (lazy route chunks, fonts), on use.
 * Everything else is left to the network untouched: every cross-origin request
 * (Supabase Auth, database, Storage, Edge Functions), every non-GET request and
 * every other same-origin path. Health, nutrition, admin or group data therefore
 * never enters the Cache Storage, and nothing private survives a logout.
 *
 * Updates are conservative: a new version installs in the background and waits;
 * the page offers "Reload", which sends SKIP_WAITING. Navigations are
 * network-first, so a reload always gets the current deployment's shell.
 */
const BUILD_ID = '__BUILD_ID__'
const PRECACHE = ['__PRECACHE__']

const CACHE_PREFIX = 'tfb-static-'
const CACHE = CACHE_PREFIX + BUILD_ID
const SHELL = '/index.html'
const PRECACHED = new Set(PRECACHE)

/** 'shell' | 'precached' | 'asset' | null (null: not handled; the network decides). */
function strategyFor(request) {
  if (request.method !== 'GET') return null
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return null
  if (request.mode === 'navigate') return 'shell'
  if (url.search) return null
  if (url.pathname.startsWith('/assets/')) return 'asset'
  if (PRECACHED.has(url.pathname)) return 'precached'
  return null
}

async function shell(request) {
  try {
    return await fetch(request)
  } catch (error) {
    const cached = await caches.match(SHELL, { cacheName: CACHE })
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request, store) {
  const cached = await caches.match(request, { cacheName: CACHE })
  if (cached) return cached
  const response = await fetch(request)
  if (store && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE.map((path) => new Request(path, { cache: 'reload' }))),
      ),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request)
  if (strategy === 'shell') event.respondWith(shell(event.request))
  else if (strategy === 'asset') event.respondWith(cacheFirst(event.request, true))
  else if (strategy === 'precached') event.respondWith(cacheFirst(event.request, false))
})
