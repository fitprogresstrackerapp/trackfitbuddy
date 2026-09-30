import { Component, type ErrorInfo, type ReactNode } from 'react'

import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'
import { describeUnexpectedError } from '@/lib/errors/unexpected-error'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last-resort boundary for errors thrown outside the router (e.g. in providers).
 * Route-level errors are handled by the router's `errorElement`.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Central place to wire error reporting later. Production logs no message or
    // stack: they can carry record data.
    if (import.meta.env.DEV)
      console.error('Unhandled application error', error, info.componentStack)
    else console.error(`Unhandled application error (${error.name})`)
  }

  override render() {
    if (this.state.error) {
      const view = describeUnexpectedError(this.state.error)
      return (
        <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
          <ErrorState
            className="w-full"
            title={view.title}
            description={view.description}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  window.location.reload()
                }}
              >
                Reload
              </Button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}
