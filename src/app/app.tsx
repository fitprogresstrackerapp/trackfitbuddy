import { RouterProvider } from 'react-router'

import { AppProviders } from './providers/app-providers'
import { router } from './router/router'

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
