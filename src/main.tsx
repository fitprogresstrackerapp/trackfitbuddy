// Must run before any Zod schema is defined (CSP: no eval).
import '@/lib/validation/zod-config'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@/styles/globals.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'

import { App } from '@/app/app'
import { registerServiceWorker } from '@/pwa/register-service-worker'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable app shell (production only; the dev server never registers it).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void registerServiceWorker({
      onUpdate: (apply) => {
        toast('A new version of TrackFitBuddy is available.', {
          duration: Infinity,
          action: { label: 'Reload', onClick: apply },
        })
      },
    })
  })
}
