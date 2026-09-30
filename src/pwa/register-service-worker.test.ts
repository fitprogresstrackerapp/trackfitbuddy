import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from './register-service-worker'

function fakeWorker(state: ServiceWorkerState = 'installed') {
  const postMessage = vi.fn()
  const worker = Object.assign(new EventTarget(), { state, postMessage })
  return { worker: worker as unknown as ServiceWorker, postMessage }
}

function fakeContainer(options: {
  controlled: boolean
  waiting?: ServiceWorker | null
  fails?: boolean
}) {
  const register = vi.fn(() =>
    options.fails ? Promise.reject(new Error('blocked')) : Promise.resolve(registration),
  )
  const registration = Object.assign(new EventTarget(), {
    waiting: options.waiting ?? null,
    installing: null as ServiceWorker | null,
    update: vi.fn(() => Promise.resolve()),
  })
  const container = Object.assign(new EventTarget(), {
    controller: options.controlled ? fakeWorker('activated').worker : null,
    register,
  })
  return { container: container as unknown as ServiceWorkerContainer, registration, register }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('registerServiceWorker', () => {
  it('registers /sw.js for the whole app without HTTP-caching the worker', async () => {
    const { container, register } = fakeContainer({ controlled: false })
    await registerServiceWorker({ onUpdate: vi.fn() }, container)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('does not offer a reload on the very first install', async () => {
    const onUpdate = vi.fn()
    const { container } = fakeContainer({ controlled: false, waiting: fakeWorker().worker })
    await registerServiceWorker({ onUpdate }, container)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('offers a waiting update once, and applies it only when asked', async () => {
    const waiting = fakeWorker()
    const onUpdate = vi.fn()
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const { container } = fakeContainer({ controlled: true, waiting: waiting.worker })
    await registerServiceWorker({ onUpdate }, container)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(waiting.postMessage).not.toHaveBeenCalled()

    const apply = onUpdate.mock.calls[0]?.[0] as () => void
    apply()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers an update found while the app is open', async () => {
    const onUpdate = vi.fn()
    const { container, registration } = fakeContainer({ controlled: true })
    await registerServiceWorker({ onUpdate }, container)
    const installing = fakeWorker('installing').worker
    registration.installing = installing
    registration.dispatchEvent(new Event('updatefound'))
    Object.defineProperty(installing, 'state', { value: 'installed' })
    installing.dispatchEvent(new Event('statechange'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('the app keeps working when registration is blocked or unsupported', async () => {
    const { container } = fakeContainer({ controlled: false, fails: true })
    await expect(registerServiceWorker({ onUpdate: vi.fn() }, container)).resolves.toBeNull()
    await expect(registerServiceWorker({ onUpdate: vi.fn() }, null)).resolves.toBeNull()
  })
})
