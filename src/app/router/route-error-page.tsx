import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'
import { describeUnexpectedError } from '@/lib/errors/unexpected-error'

import { NotFoundPage } from './not-found-page'

/** Router `errorElement`: catches loader/render errors for any route. */
export function RouteErrorPage() {
  const error = useRouteError()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />
  }

  if (import.meta.env.DEV) {
    console.error(error)
  }

  const view = describeUnexpectedError(error)
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <ErrorState
        className="w-full"
        title={view.title}
        description={view.description}
        action={
          <div className="flex flex-wrap gap-2">
            {view.reload && (
              <Button
                size="sm"
                onClick={() => {
                  window.location.reload()
                }}
              >
                Reload
              </Button>
            )}
            <Button asChild variant="secondary" size="sm">
              <Link to={ROUTES.home}>Go home</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}
