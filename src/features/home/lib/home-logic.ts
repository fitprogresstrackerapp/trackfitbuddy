import { evaluateNutrient } from '@/features/nutrition/lib/nutrition'

import type { DailyTargets, HomeNutrition, HomeTraining, PlanCycle } from '../types'

/*
 * Pure Home calculations (no I/O). The database defines what is valid
 * (soft deletion, active step entry, snapshots); these functions only
 * summarise already-filtered rows for today.
 */

export {
  calorieBalance,
  evaluateCalories,
  evaluateNutrient,
  sumNutrition,
  type CalorieStatus,
  type NutrientStatus,
} from '@/features/nutrition/lib/nutrition'

/** Distinct days (up to and including today) with at least one valid workout. */
export function countWorkoutDays(workoutDates: readonly string[], today: string): number {
  return new Set(workoutDates.filter((date) => date <= today)).size
}

export type PlanState =
  { kind: 'none' } | { kind: 'review'; until: string } | { kind: 'active'; since: string }

/** Recommendation state as visible to the user (processing runs are admin-only data). */
export function planState(cycle: PlanCycle | null, today: string): PlanState {
  if (!cycle) return { kind: 'none' }
  if (cycle.status === 'IN_REVIEW' && today <= cycle.reviewDeadline) {
    return { kind: 'review', until: cycle.reviewDeadline }
  }
  return { kind: 'active', since: cycle.periodStart }
}

/**
 * True when the current recommendation cycle began inside this calendar week:
 * the week is a transition week and must not be judged as a full target week
 * (spec §17). Home then shows the count without a completion judgement.
 */
export function isTransitionWeek(
  cycle: PlanCycle | null,
  week: { start: string; end: string },
): boolean {
  return Boolean(cycle && cycle.periodStart > week.start && cycle.periodStart <= week.end)
}

/** The next template session: sessions are done in order, on any days (spec §16). */
export function nextSession(cycle: PlanCycle | null, workoutDaysThisWeek: number): string | null {
  if (!cycle || cycle.sessions.length === 0) return null
  if (workoutDaysThisWeek >= cycle.sessions.length) return null
  return cycle.sessions[workoutDaysThisWeek] ?? null
}

export type NextActionTarget = 'food' | 'workout' | 'activity'

export interface NextAction {
  message: string
  detail?: string
  action: NextActionTarget | null
}

interface NextActionInput {
  nutrition: HomeNutrition | undefined
  training: HomeTraining | undefined
  targets: DailyTargets | null | undefined
}

/**
 * One deterministic suggestion, most useful first. No AI; no invented goals.
 * Sections that failed to load are simply skipped.
 */
export function nextAction({ nutrition, training, targets }: NextActionInput): NextAction {
  if (nutrition?.totals === null) {
    return {
      message: 'No meals logged today.',
      detail: targets
        ? 'Log what you eat to see how today compares with your targets.'
        : 'Log what you eat to build your daily record.',
      action: 'food',
    }
  }

  if (nutrition?.totals && targets) {
    const protein = evaluateNutrient(nutrition.totals.proteinG, targets.proteinG, targets.tolerance)
    const below =
      protein === 'below' || (protein === null && nutrition.totals.proteinG < targets.proteinG)
    if (below) {
      const toGo = Math.max(0, Math.round(targets.proteinG - nutrition.totals.proteinG))
      return {
        message: 'Protein is still below today’s target.',
        detail: `${String(toGo)} g to go.`,
        action: 'food',
      }
    }
  }

  if (
    training &&
    targets &&
    training.workoutsToday.length === 0 &&
    training.workoutDaysThisWeek < targets.workoutsPerWeek
  ) {
    return {
      message: 'No workout logged today.',
      detail: `This week: ${String(training.workoutDaysThisWeek)} / ${String(targets.workoutsPerWeek)} workout days.`,
      action: 'workout',
    }
  }

  if (training?.steps === null) {
    return { message: 'No steps entered today.', action: 'activity' }
  }

  // Never claim "nothing urgent" about data that failed to load.
  if (!nutrition || !training) {
    return {
      message: 'Some of today’s data couldn’t be loaded.',
      detail: 'Retry the section above to see what’s next.',
      action: null,
    }
  }

  return {
    message: 'Nothing urgent.',
    detail: 'Keep logging today’s meals and activity.',
    action: null,
  }
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}
