import type { LucideIcon } from 'lucide-react'

import { InlineAlert } from '@/components/common/inline-alert'
import { DataRow, MetricBlock } from '@/components/data/metric'
import type { ProgressTone } from '@/components/data/progress-bar'
import { StatusBadge } from '@/components/data/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { formatNumber } from '@/lib/format'

import {
  calorieBalance,
  evaluateCalories,
  evaluateNutrient,
  type CalorieStatus,
} from '../lib/nutrition'
import type { DailyTargets, NutritionTotals } from '../types'

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

const GRID = 'grid gap-x-12 gap-y-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'

function CalorieBalance({
  totals,
  targets,
  emptyText,
  past,
}: {
  totals: NutritionTotals | null
  targets: DailyTargets | null
  emptyText: string
  past: boolean
}) {
  if (!targets) {
    return totals ? null : <p className="text-sm text-muted-foreground">{emptyText}</p>
  }
  const balance = calorieBalance(totals?.calories ?? null, targets.calories)
  const status = evaluateCalories(totals?.calories ?? null, targets.calories, targets.tolerance)

  let text = emptyText
  if (balance) {
    if (balance.remaining > 0)
      text = `${formatNumber(balance.remaining)} kcal ${past ? 'under target' : 'remaining'}`
    else if (balance.remaining < 0) text = `${formatNumber(-balance.remaining)} kcal over target`
    else text = 'Target reached'
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm text-foreground-secondary">{text}</p>
      {status === 'below' && <StatusBadge status="pending" label="Below range" />}
      {status === 'within' && <StatusBadge status="on-track" label="Within range" />}
      {status === 'above' && <StatusBadge status="warning" label="Above range" />}
    </div>
  )
}

interface NutritionSummaryProps {
  /** Logged totals; `null` = nothing logged (shown as "—", never 0). */
  totals: NutritionTotals | null
  targets: DailyTargets | null
  /** Targets query state: 'error' shows a retry note; intake stays visible. */
  targetsState: 'ready' | 'error'
  onRetryTargets?: () => void
  /** Shown under calories when nothing is logged, e.g. "No meals logged today". */
  emptyText: string
  /** A finished day: the balance reads "under target" rather than "remaining". */
  past?: boolean
}

/**
 * Calories against the food target (range) plus protein, carbs, fat and fiber
 * against their targets (snapshot tolerance). Shared by Home and Food.
 */
export function NutritionSummary({
  totals,
  targets,
  targetsState,
  onRetryTargets,
  emptyText,
  past = false,
}: NutritionSummaryProps) {
  const calorieStatus = targets
    ? evaluateCalories(totals?.calories ?? null, targets.calories, targets.tolerance)
    : null

  return (
    <div className="flex flex-col gap-6">
      {targetsState === 'error' && (
        <InlineAlert tone="warning" title="Targets couldn’t be loaded">
          <span className="flex flex-wrap items-center gap-3">
            Intake is shown without targets.
            {onRetryTargets && (
              <Button variant="link" onClick={onRetryTargets}>
                Retry
              </Button>
            )}
          </span>
        </InlineAlert>
      )}
      {targetsState === 'ready' && !targets && (
        <InlineAlert tone="info" title="No active recommendation">
          Daily targets are not available yet.
        </InlineAlert>
      )}

      <div className={GRID}>
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
          <CalorieBalance totals={totals} targets={targets} emptyText={emptyText} past={past} />
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
                fractionDigits={1}
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

export function NutritionSummarySkeleton() {
  return (
    <div className={GRID} aria-hidden="true">
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
