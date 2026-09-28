import type { UseQueryResult } from '@tanstack/react-query'

import { EmptyState } from '@/components/common/empty-state'
import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { ICONS } from '@/constants/icons'
import { focusLabel, longTermGoalLabel } from '@/features/profile/lib/goals'
import { formatShortDate } from '@/lib/dates/local-date'

import type { CurrentPlan } from '../api/progress-data'
import { formatSigned } from '../lib/progress-format'
import type { Change } from '../lib/progress-logic'
import type { GoalInfo } from '../types'
import { SectionSkeleton } from './progress-ui'

function sameGoal(a: GoalInfo | null, b: GoalInfo | null): boolean {
  if (!a || !b) return false
  return (
    a.longTermGoal === b.longTermGoal &&
    a.effectiveFrom === b.effectiveFrom &&
    a.focuses.join() === b.focuses.join()
  )
}

function GoalBlock({ goal, eyebrow }: { goal: GoalInfo; eyebrow: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="label-mono text-muted-foreground">{eyebrow}</p>
      <p className="heading-block text-foreground">{longTermGoalLabel(goal.longTermGoal)}</p>
      {goal.focuses.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Short-term focus">
          {goal.focuses.map((focus) => (
            <li
              key={focus}
              className="rounded-xs border border-border px-2 py-1 label-mono text-foreground-secondary"
            >
              {focusLabel(focus)}
            </li>
          ))}
        </ul>
      )}
      {goal.description && <p className="text-sm text-foreground-secondary">{goal.description}</p>}
    </div>
  )
}

interface GoalsProgressProps {
  plan: UseQueryResult<CurrentPlan>
  /** Weight change in the selected range, as observed context. */
  weight: Change | null
  bodyFat: Change | null
}

/**
 * Goals (spec §22): the goal locked to the current cycle and the profile's
 * active goal. Goals carry no numeric target in Phase 1, so no progress
 * percentage is shown — only observed changes as context, never predictions.
 */
export function GoalsProgress({ plan, weight, bodyFat }: GoalsProgressProps) {
  const cycleGoal = plan.data?.cycleGoal ?? null
  const activeGoal = plan.data?.activeGoal ?? null
  const showActive = activeGoal && !sameGoal(activeGoal, cycleGoal)
  const bodyGoal = [cycleGoal, activeGoal].some(
    (goal) => goal?.longTermGoal === 'FAT_LOSS' || goal?.longTermGoal === 'MUSCLE_GAIN',
  )

  return (
    <Section title="Goals">
      {plan.isError ? (
        <SectionError title="Goals unavailable" onRetry={() => void plan.refetch()} />
      ) : plan.isPending ? (
        <SectionSkeleton chart={false} />
      ) : !cycleGoal && !activeGoal ? (
        <EmptyState
          icon={ICONS.goals}
          title="No goals set"
          description="Goals are set in your profile."
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-6 sm:grid-cols-2">
            {cycleGoal && <GoalBlock goal={cycleGoal} eyebrow="This cycle" />}
            {showActive && (
              <GoalBlock
                goal={activeGoal}
                eyebrow={
                  cycleGoal
                    ? `Profile goal · from ${formatShortDate(activeGoal.effectiveFrom)}, applies next cycle`
                    : 'Profile goal'
                }
              />
            )}
          </div>
          {bodyGoal && (weight?.delta != null || bodyFat?.delta != null) && (
            <ul className="flex flex-col gap-1 text-sm text-foreground-secondary">
              {weight?.delta != null && (
                <li>
                  Weight changed by {formatSigned(weight.delta, 1, 'kg')} in the selected range.
                </li>
              )}
              {bodyFat?.delta != null && (
                <li>
                  Body fat changed by {formatSigned(bodyFat.delta, 1, 'percentage points')} in the
                  selected range.
                </li>
              )}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Goals have no numeric target yet, so no completion percentage is shown.
          </p>
        </div>
      )}
    </Section>
  )
}
