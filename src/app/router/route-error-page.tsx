import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'

import { NotFoundPage } from './not-found-page'

function describeError(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}

/** Router `errorElement`: catches loader/render errors for any route. */
export function RouteErrorPage() {
  const error = useRouteError()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />
  }

  if (import.meta.env.DEV) {
    console.error(error)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <ErrorState
        className="w-full"
        description={describeError(error)}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to={ROUTES.home}>Go home</Link>
          </Button>
        }
      />
    </div>
  )
}
