import type { UseQueryResult } from '@tanstack/react-query'

import { StatusBadge } from '@/components/data/status-badge'
import { PageHeader } from '@/components/layout/page'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDayLabel, formatShortDate, hourInTimeZone } from '@/lib/dates/local-date'

import { greetingFor, planState } from '../lib/home-logic'
import type { HomePlan } from '../types'

interface HomeHeaderProps {
  name: string | null
  today: string
  timeZone: string
  plan: UseQueryResult<HomePlan>
}

function PlanBadge({ plan, today }: { plan: UseQueryResult<HomePlan>; today: string }) {
  if (plan.isPending) return <Skeleton className="h-6 w-32" />
  if (plan.isError) return null
  const state = planState(plan.data.cycle, today)
  if (state.kind === 'review') {
    return <StatusBadge status="pending" label={`Review until ${formatShortDate(state.until)}`} />
  }
  if (state.kind === 'active') return <StatusBadge status="active" label="Plan active" />
  return <StatusBadge status="pending" label="No recommendation available" />
}

/** "SUN 27 SEP · GOOD MORNING" over the user's first name (spec §9 top section). */
export function HomeHeader({ name, today, timeZone, plan }: HomeHeaderProps) {
  const firstName = name?.trim().split(/\s+/)[0]
  const greeting = greetingFor(hourInTimeZone(timeZone))
  return (
    <PageHeader
      eyebrow={
        <>
          <time dateTime={today}>{formatDayLabel(today)}</time> · {greeting}
        </>
      }
      title={firstName ?? 'Today'}
      actions={<PlanBadge plan={plan} today={today} />}
    />
  )
}
