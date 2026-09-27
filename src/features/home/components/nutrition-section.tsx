import type { UseQueryResult } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'

import { InlineAlert } from '@/components/common/inline-alert'
import { DataRow, MetricBlock } from '@/components/data/metric'
import type { ProgressTone } from '@/components/data/progress-bar'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { formatNumber } from '@/lib/format'

import {
  calorieBalance,
  evaluateCalories,
  evaluateNutrient,
  type CalorieStatus,
} from '../lib/home-logic'
import type { DailyTargets, HomeNutrition, HomePlan, NutritionTotals } from '../types'
import { SectionError } from './section-error'

type MacroKey = 'proteinG' | 'carbsG' | 'fatG' | 'fiberG'

const MACROS: readonly { key: MacroKey; label: string; icon: LucideIcon }[] = [
  { key: 'proteinG', label: 'Protein', icon: ICONS.protein },
  { key: 'carbsG', label: 'Carbs', icon: ICONS.carbs },
  { key: 'fatG', label: 'Fat', icon: ICONS.fat },
  { key: 'fiberG', label: 'Fiber', icon: ICONS.fiber },
]

const CALORIE_TONES: Record<CalorieStatus, ProgressTone> = {
  'no-data': 'default',
  below: 'default',
  within: 'complete',
  above: 'attention',
}

function CalorieBalance({
  totals,
  targets,
}: {
  totals: NutritionTotals | null
  targets: DailyTargets | null
}) {
  if (!targets) {
    return totals ? null : <p className="text-sm text-muted-foreground">No meals logged today</p>
  }
  const balance = calorieBalance(totals?.calories ?? null, targets.calories)
  const status = evaluateCalories(totals?.calories ?? null, targets.calories, targets.tolerance)

  let text = 'No meals logged today'
  if (balance) {
    if (balance.remaining > 0) text = `${formatNumber(balance.remaining)} kcal remaining`
    else if (balance.remaining < 0) text = `${formatNumber(-balance.remaining)} kcal over target`
    else text = 'Target reached'
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm text-foreground-secondary">{text}</p>
      {status === 'within' && <StatusBadge status="on-track" label="Within range" />}
      {status === 'above' && <StatusBadge status="warning" label="Above range" />}
    </div>
  )
}

function NutritionBody({
  totals,
  plan,
}: {
  totals: NutritionTotals | null
  plan: UseQueryResult<HomePlan>
}) {
  const targets = plan.data?.targets ?? null
  const calorieStatus = targets
    ? evaluateCalories(totals?.calories ?? null, targets.calories, targets.tolerance)
    : null

  return (
    <div className="flex flex-col gap-6">
      {plan.isError && (
        <InlineAlert tone="warning" title="Today’s targets couldn’t be loaded">
          <span className="flex flex-wrap items-center gap-3">
            Intake is shown without targets.
            <Button variant="link" className="h-auto" onClick={() => void plan.refetch()}>
              Retry
            </Button>
          </span>
        </InlineAlert>
      )}
      {plan.isSuccess && !targets && (
        <InlineAlert tone="info" title="No active recommendation">
          Daily targets are not available yet.
        </InlineAlert>
      )}

      <div className="grid gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <MetricBlock
            label="Calories"
            icon={ICONS.calories}
            value={totals?.calories ?? null}
            target={targets?.calories ?? null}
            unit="KCAL"
            size="xl"
            {...(targets ? { meta: 'Food target' } : {})}
            {...(calorieStatus && calorieStatus !== 'no-data'
              ? { tone: CALORIE_TONES[calorieStatus] }
              : {})}
          />
          <CalorieBalance totals={totals} targets={targets} />
        </div>
        <div className="divide-y divide-border border-y border-border md:border-t-0">
          {MACROS.map((macro) => {
            const value = totals?.[macro.key] ?? null
            const target = targets?.[macro.key] ?? null
            const status =
              target === null ? null : evaluateNutrient(value, target, targets?.tolerance ?? null)
            return (
              <DataRow
                key={macro.key}
                label={macro.label}
                icon={macro.icon}
                value={value}
                target={target}
                unit="G"
                {...(status === 'met' ? { meta: 'Met', tone: 'complete' as const } : {})}
                {...(status === 'below' ? { tone: 'default' as const } : {})}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function NutritionSkeleton() {
  return (
    <div
      className="grid gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
      aria-hidden="true"
    >
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-16 w-56" />
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex flex-col gap-5">
        {MACROS.map((macro) => (
          <div key={macro.key} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

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
          <NutritionSkeleton />
        </>
      ) : nutrition.isError ? (
        <SectionError
          title="Couldn’t load today’s meals"
          onRetry={() => void nutrition.refetch()}
        />
      ) : (
        <NutritionBody totals={totals} plan={plan} />
      )}
    </Section>
  )
}
