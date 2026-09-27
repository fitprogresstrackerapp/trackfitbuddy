import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <div className="space-y-2">
        <p className="label-mono text-muted-foreground">Error 404</p>
        <h1 className="heading-page text-foreground">Not found</h1>
        <p className="text-sm text-foreground-secondary">
          The page you’re looking for doesn’t exist or has moved.
        </p>
      </div>
      <div>
        <Button asChild variant="secondary">
          <Link to={ROUTES.home}>Go home</Link>
        </Button>
      </div>
    </div>
  )
}
