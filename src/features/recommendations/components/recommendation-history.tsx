import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Skeleton } from '@/components/ui/skeleton'
import { formatShortDate } from '@/lib/dates/local-date'

import { useRecommendationHistory } from '../api/recommendation-queries'
import { historyLabel } from '../lib/recommendation-logic'

/**
 * Minimal recommendation history (Prompt 10 §112): generation date and
 * whether it is in review, active or previous. No processing internals.
 */
export function RecommendationHistory({ userId, today }: { userId: string; today: string }) {
  const history = useRecommendationHistory(userId)

  return (
    <Section title="Recommendation history">
      {history.isError ? (
        <SectionError title="History unavailable" onRetry={() => void history.refetch()} />
      ) : history.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : history.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recommendation has been generated yet.</p>
      ) : (
        <ol className="divide-y divide-border border-y border-border">
          {history.data.map((item) => {
            const label = historyLabel(item, today)
            return (
              <li key={item.id} className="flex items-center gap-3 py-2.5">
                <span className="label-mono text-foreground">
                  {formatShortDate(item.periodStart)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.periodEnd ? `until ${formatShortDate(item.periodEnd)}` : ''}
                </span>
                <span className="ml-auto">
                  {label === 'In review' ? (
                    <StatusBadge status="pending" label="In review" />
                  ) : label === 'Active' ? (
                    <StatusBadge status="active" />
                  ) : (
                    <StatusBadge status="locked" label="Previous" />
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </Section>
  )
}
