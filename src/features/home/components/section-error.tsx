import { ErrorState } from '@/components/common/error-state'
import { Button } from '@/components/ui/button'

/** Compact, retryable failure for one Home section — never replaced by fake zeros. */
export function SectionError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <ErrorState
      title={title}
      description="Check your connection and try again."
      action={
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  )
}
