import { Link } from 'react-router'

import { SectionError } from '@/components/common/section-error'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { formatMoney } from '@/features/recommendations/lib/recommendation-logic'
import { formatNumber } from '@/lib/format'

import { useAudit, useDashboard } from '../api/admin-queries'
import { actionLabel, domainLabel } from '../lib/admin-logic'

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const EMPTY_FILTERS = { from: '', to: '', action: null, entity: null, actor: '', target: '' }

/**
 * Admin dashboard (spec §78): concise indicators computed from existing data,
 * and recent administrative activity. No charts.
 */
export function AdminDashboardPage() {
  const dashboard = useDashboard()
  const recent = useAudit(EMPTY_FILTERS, 0, 6)

  return (
    <Page>
      <Breadcrumb items={[{ label: 'Admin' }]} />
      <PageHeader
        eyebrow="Control"
        title="Dashboard"
        description="Operational status at a glance."
      />

      <Section title="Status">
        {dashboard.isError ? (
          <SectionError title="Status unavailable" onRetry={() => void dashboard.refetch()} />
        ) : dashboard.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 xl:grid-cols-5">
            {[
              {
                label: 'Active users',
                value: formatNumber(dashboard.data.activeUsers),
                to: ROUTES.adminUsers,
              },
              {
                label: 'Inactive users',
                value: formatNumber(dashboard.data.inactiveUsers),
                to: ROUTES.adminUsers,
              },
              {
                label: 'Incomplete profiles',
                value: formatNumber(dashboard.data.incompleteProfiles),
                to: ROUTES.adminUsers,
              },
              {
                label: 'In review',
                value: formatNumber(dashboard.data.recommendationsInReview),
                to: ROUTES.adminProcessing,
              },
              {
                label: 'Processing pending',
                value: formatNumber(dashboard.data.recommendationsPending),
                to: ROUTES.adminProcessing,
              },
              {
                label: 'Processing failed',
                value: formatNumber(dashboard.data.recommendationFailures),
                to: ROUTES.adminProcessing,
              },
              {
                label: 'Active groups',
                value: formatNumber(dashboard.data.activeGroups),
                to: null,
              },
              {
                label: 'Food submissions',
                value: formatNumber(dashboard.data.foodSubmissionsPending),
                to: null,
              },
              {
                label: 'AI spend (est.)',
                value: formatMoney(dashboard.data.aiSpend, dashboard.data.aiCurrency),
                to: ROUTES.adminProcessing,
              },
              {
                label: 'AI budget',
                value:
                  dashboard.data.aiBudget === null
                    ? 'Not set'
                    : formatMoney(dashboard.data.aiBudget, dashboard.data.aiCurrency),
                to: null,
              },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-1 bg-background px-3 py-2.5">
                <dt className="label-mono text-muted-foreground">
                  {item.to ? (
                    <Link to={item.to} className="hover:text-foreground">
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </dt>
                <dd className="text-lg text-foreground tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section
        title="Recent activity"
        action={
          <Button asChild variant="link" className="text-sm">
            <Link to={ROUTES.adminAudit}>All audit</Link>
          </Button>
        }
      >
        {recent.isError ? (
          <SectionError title="Recent activity unavailable" onRetry={() => void recent.refetch()} />
        ) : recent.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : recent.data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {recent.data.rows.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className="label-mono text-muted-foreground">
                  {dateTime.format(new Date(entry.createdAt))}
                </span>
                <span className="font-medium text-foreground">{actionLabel(entry)}</span>
                <span className="min-w-0 break-words text-foreground-secondary">
                  {domainLabel(entry.entityType)}
                  {entry.targetName ? ` · ${entry.targetName}` : ''} · by{' '}
                  {entry.actorName ?? 'System'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  )
}
