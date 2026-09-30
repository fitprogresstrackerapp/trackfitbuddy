// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it, vi } from 'vitest'

import { renderServiceWorker } from '../../scripts/vite-plugin-service-worker'

/*
 * Runs the real service worker source in a sandbox with fake Cache Storage and
 * network, and asserts what it may and may not cache.
 */

const ORIGIN = 'https://app.trackfitbuddy.test'
const PRECACHE = [
  '/index.html',
  '/assets/index-abc.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
]

type Listener = (event: Record<string, unknown>) => void

function load(buildId = 'build-1') {
  const source = renderServiceWorker(
    readFileSync(resolve(import.meta.dirname, 'service-worker.js'), 'utf8'),
    buildId,
    PRECACHE,
  )
  const stores = new Map<string, Map<string, Response>>()
  const listeners = new Map<string, Listener>()
  // Same-origin network responses are "basic", as in a browser.
  const network = vi.fn((request: Request) => {
    const response = new Response(`network:${new URL(request.url).pathname}`, { status: 200 })
    Object.defineProperty(response, 'type', { value: 'basic' })
    return Promise.resolve(response)
  })
  const keyOf = (request: Request | string) =>
    typeof request === 'string' ? new URL(request, ORIGIN).href : request.url
  const store = (name: string) => {
    let cache = stores.get(name)
    if (!cache) stores.set(name, (cache = new Map<string, Response>()))
    return cache
  }
  const caches = {
    open: (name: string) =>
      Promise.resolve({
        addAll: async (requests: Request[]) => {
          for (const request of requests) store(name).set(keyOf(request), await network(request))
        },
        put: (request: Request, response: Response) => {
          store(name).set(keyOf(request), response)
          return Promise.resolve()
        },
      }),
    match: (request: Request | string, options?: { cacheName?: string }) =>
      Promise.resolve(
        options?.cacheName ? stores.get(options.cacheName)?.get(keyOf(request)) : undefined,
      ),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  }
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(() => Promise.resolve()),
    clients: { claim: vi.fn(() => Promise.resolve()) },
  }
  runInNewContext(source, {
    self,
    caches,
    fetch: (request: Request) => network(request),
    Request: class extends Request {
      constructor(input: string, init?: RequestInit) {
        super(new URL(input, ORIGIN), init)
      }
    },
    URL,
    Set,
    Promise,
    JSON,
  })

  const lifecycle = async (type: 'install' | 'activate') => {
    let pending: Promise<unknown> = Promise.resolve()
    listeners.get(type)?.({ waitUntil: (promise: Promise<unknown>) => (pending = promise) })
    await pending
  }
  const request = async (url: string, init: RequestInit & { mode?: RequestMode } = {}) => {
    const { mode, ...rest } = init
    const req = new Request(new URL(url, ORIGIN), rest)
    if (mode === 'navigate') Object.defineProperty(req, 'mode', { value: 'navigate' })
    let responded = null as Promise<Response> | null
    listeners.get('fetch')?.({
      request: req,
      respondWith: (p: Promise<Response>) => (responded = p),
    })
    return responded
  }
  return { stores, network, self, lifecycle, request, listeners }
}

const cachedUrls = (stores: Map<string, Map<string, Response>>) =>
  [...stores.values()].flatMap((cache) => [...cache.keys()])

describe('service worker', () => {
  it('precaches only the public app shell', async () => {
    const sw = load()
    await sw.lifecycle('install')
    expect(
      cachedUrls(sw.stores)
        .map((url) => new URL(url).pathname)
        .sort(),
    ).toEqual([...PRECACHE].sort())
    expect(sw.self.skipWaiting).not.toHaveBeenCalled() // waits for the user's "Reload"
  })

  it('never handles Supabase or any other cross-origin request', async () => {
    const sw = load()
    for (const url of [
      'https://abc.supabase.co/rest/v1/meals?select=*',
      'https://abc.supabase.co/auth/v1/token?grant_type=refresh_token',
      'https://abc.supabase.co/storage/v1/object/sign/inbody-reports/u/1.pdf',
      'https://abc.supabase.co/functions/v1/process-recommendations',
    ]) {
      expect(await sw.request(url)).toBeNull()
    }
    expect(cachedUrls(sw.stores)).toEqual([])
  })

  it('never handles non-GET requests or unknown same-origin paths', async () => {
    const sw = load()
    expect(await sw.request('/assets/index-abc.js', { method: 'POST', body: 'x' })).toBeNull()
    expect(await sw.request('/rest/v1/workouts')).toBeNull()
    expect(await sw.request('/api/anything')).toBeNull()
    expect(await sw.request('/assets/index-abc.js?token=secret')).toBeNull()
  })

  it('caches content-hashed build assets on first use', async () => {
    const sw = load()
    const response = await sw.request('/assets/progress-page-xyz.js')
    expect(await response?.text()).toBe('network:/assets/progress-page-xyz.js')
    expect(cachedUrls(sw.stores)).toEqual([`${ORIGIN}/assets/progress-page-xyz.js`])
    await sw.request('/assets/progress-page-xyz.js')
    expect(sw.network).toHaveBeenCalledTimes(1)
  })

  it('navigations are network-first, fall back to the cached shell offline, and are not stored', async () => {
    const sw = load()
    await sw.lifecycle('install')
    const before = cachedUrls(sw.stores).length
    const online = await sw.request('/food?date=2026-09-30', { mode: 'navigate' })
    expect(await online?.text()).toBe('network:/food')
    expect(cachedUrls(sw.stores)).toHaveLength(before)

    sw.network.mockRejectedValueOnce(new TypeError('offline'))
    const offline = await sw.request('/progress', { mode: 'navigate' })
    expect(await offline?.text()).toBe('network:/index.html')
  })

  it('a new version removes the previous version’s cache on activation', async () => {
    const first = load('build-1')
    await first.lifecycle('install')
    const second = load('build-2')
    for (const [name, cache] of first.stores) second.stores.set(name, cache)
    await second.lifecycle('install')
    await second.lifecycle('activate')
    expect([...second.stores.keys()]).toEqual(['tfb-static-build-2'])
    expect(second.self.clients.claim).toHaveBeenCalled()
  })

  it('takes over only when the page asks (SKIP_WAITING)', () => {
    const sw = load()
    sw.listeners.get('message')?.({ data: { type: 'OTHER' } })
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
    sw.listeners.get('message')?.({ data: { type: 'SKIP_WAITING' } })
    expect(sw.self.skipWaiting).toHaveBeenCalled()
  })
})
