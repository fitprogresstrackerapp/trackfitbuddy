/**
 * Registers /sw.js (production builds only; see src/pwa/service-worker.js).
 *
 * Update strategy (conservative): a new deployment's worker installs in the
 * background and waits. The user is offered "Reload"; only then is the worker
 * told to take over and the page reloaded once. Nothing is replaced mid-task.
 */
export interface ServiceWorkerOptions {
  /** Called when a new version is ready; `apply` activates it and reloads. */
  onUpdate: (apply: () => void) => void
  /** Minimum time between background update checks when the app regains focus. */
  checkIntervalMs?: number
}

export async function registerServiceWorker(
  { onUpdate, checkIntervalMs = 60 * 60 * 1000 }: ServiceWorkerOptions,
  container: ServiceWorkerContainer | null = 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : null,
): Promise<ServiceWorkerRegistration | null> {
  if (!container) return null

  let registration: ServiceWorkerRegistration
  try {
    registration = await container.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  } catch {
    // Unsupported or blocked (private mode, disabled storage): the app works without it.
    return null
  }

  let offered = false
  const offer = (worker: ServiceWorker | null) => {
    // Only an *update* (a worker already controls the page) needs a reload.
    if (!worker || offered || !container.controller) return
    offered = true
    onUpdate(() => {
      container.addEventListener(
        'controllerchange',
        () => {
          window.location.reload()
        },
        { once: true },
      )
      worker.postMessage({ type: 'SKIP_WAITING' })
    })
  }

  offer(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') offer(registration.waiting ?? installing)
    })
  })

  let lastCheck = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < checkIntervalMs) return
    lastCheck = Date.now()
    registration.update().catch(() => undefined)
  })

  return registration
}
