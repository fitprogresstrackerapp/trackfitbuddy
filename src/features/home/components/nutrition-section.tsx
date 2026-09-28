import type { UseQueryResult } from '@tanstack/react-query'

import { Section } from '@/components/layout/page'
import {
  NutritionSummary,
  NutritionSummarySkeleton,
} from '@/features/nutrition/components/nutrition-summary'

import type { HomeNutrition, HomePlan } from '../types'
import { SectionError } from '@/components/common/section-error'

interface NutritionSectionProps {
  plan: UseQueryResult<HomePlan>
  nutrition: UseQueryResult<HomeNutrition>
}

/** Primary Home metric: today's food intake against today's food targets. */
export function NutritionSection({ plan, nutrition }: NutritionSectionProps) {
  const totals = nutrition.data?.totals ?? null
  const meta = nutrition.isSuccess
    ? totals
      ? `${String(totals.mealCount)} ${totals.mealCount === 1 ? 'meal' : 'meals'} · ${String(totals.itemCount)} ${totals.itemCount === 1 ? 'item' : 'items'}`
      : 'Nothing logged'
    : undefined

  return (
    <Section title="Nutrition" meta={meta}>
      {nutrition.isPending || plan.isPending ? (
        <>
          <span className="sr-only" role="status">
            Loading nutrition
          </span>
          <NutritionSummarySkeleton />
        </>
      ) : nutrition.isError ? (
        <SectionError
          title="Couldn’t load today’s meals"
          onRetry={() => void nutrition.refetch()}
        />
      ) : (
        <NutritionSummary
          totals={totals}
          targets={plan.data?.targets ?? null}
          targetsState={plan.isError ? 'error' : 'ready'}
          onRetryTargets={() => void plan.refetch()}
          emptyText="No meals logged today"
        />
      )}
    </Section>
  )
}
