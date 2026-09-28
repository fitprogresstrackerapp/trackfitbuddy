import type { UseQueryResult } from '@tanstack/react-query'
import { ArrowRight, Plus } from 'lucide-react'
import { Link } from 'react-router'

import { Panel, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ADD_ACTION_ROUTES } from '@/constants/routes'
import { focusLabel, longTermGoalLabel } from '@/features/profile/lib/goals'

import { nextAction, nextSession, type NextActionTarget } from '../lib/home-logic'
import type { HomeNutrition, HomePlan, HomeTraining } from '../types'
import { SectionError } from '@/components/common/section-error'

const ACTION_LABELS: Record<NextActionTarget, string> = {
  food: 'Add food',
  workout: 'Add workout',
  activity: 'Add activity',
}

interface NextPanelProps {
  plan: UseQueryResult<HomePlan>
  nutrition: UseQueryResult<HomeNutrition>
  training: UseQueryResult<HomeTraining>
}

/** One deterministic next step (no AI). Plus the next template session, if a plan exists. */
export function NextPanel({ plan, nutrition, training }: NextPanelProps) {
  const loading = plan.isPending || nutrition.isPending || training.isPending
  const next = nextAction({
    nutrition: nutrition.data,
    training: training.data,
    targets: plan.data?.targets,
  })
  const session = nextSession(plan.data?.cycle ?? null, training.data?.workoutDaysThisWeek ?? 0)

  return (
    <Panel variant="accent" title="Next">
      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <p className="heading-block text-foreground">{next.message}</p>
            {next.detail && <p className="text-sm text-foreground-secondary">{next.detail}</p>}
          </div>
          {session && (
            <p className="label-mono text-foreground-secondary">
              Next session · <span className="text-foreground">{session}</span>
            </p>
          )}
          {next.action && (
            <div>
              {/* A contextual pointer, not a second primary button (the Log actions follow). */}
              <Button asChild variant="link" className="text-sm">
                <Link to={ADD_ACTION_ROUTES[next.action]}>
                  {ACTION_LABELS[next.action]}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}

/** Add Food is the primary action; workout and activity are secondary (spec §9). */
export function HomeActions() {
  const secondary = 'h-11 sm:h-9 sm:px-4 sm:text-xs'
  return (
    <div role="group" aria-label="Log" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Button asChild size="lg" className={`col-span-2 ${secondary}`}>
        <Link to={ADD_ACTION_ROUTES.food}>
          <Plus aria-hidden="true" />
          Add food
        </Link>
      </Button>
      <Button asChild variant="secondary" size="lg" className={secondary}>
        <Link to={ADD_ACTION_ROUTES.workout}>
          <Plus aria-hidden="true" />
          Add workout
        </Link>
      </Button>
      <Button asChild variant="secondary" size="lg" className={secondary}>
        <Link to={ADD_ACTION_ROUTES.activity}>
          <Plus aria-hidden="true" />
          Add activity
        </Link>
      </Button>
    </div>
  )
}

/** Goals locked for the current recommendation cycle only (spec §9 "Current goals"). */
export function FocusSection({ plan }: { plan: UseQueryResult<HomePlan> }) {
  return (
    <Section title="Current focus" meta={plan.data?.cycle ? 'This cycle' : undefined}>
      {plan.isPending ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : plan.isError ? (
        <SectionError title="Couldn’t load your focus" onRetry={() => void plan.refetch()} />
      ) : !plan.data.cycle ? (
        <p className="text-sm text-muted-foreground">
          Focus areas are set with your first recommendation.
        </p>
      ) : !plan.data.goal ? (
        <p className="text-sm text-muted-foreground">No goals are recorded for this cycle.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {plan.data.goal.focuses.length > 0 && (
            <ul className="flex flex-col gap-2">
              {plan.data.goal.focuses.map((focus) => (
                <li key={focus} className="flex items-center gap-2.5 text-sm text-foreground">
                  <span aria-hidden="true" className="size-1.5 bg-primary" />
                  {focusLabel(focus)}
                </li>
              ))}
            </ul>
          )}
          <dl className="flex items-baseline gap-3 border-t border-border pt-3">
            <dt className="label-mono text-muted-foreground">Long-term</dt>
            <dd className="text-sm text-foreground-secondary">
              {longTermGoalLabel(plan.data.goal.longTermGoal)}
            </dd>
          </dl>
        </div>
      )}
    </Section>
  )
}
