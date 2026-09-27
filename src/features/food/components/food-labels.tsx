import { StatusBadge } from '@/components/data/status-badge'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { NutritionPreview } from '../lib/food-logic'
import type { FoodOption, ReviewStatus } from '../types'

/**
 * Where a food's values come from: VERIFIED (shared, curated), PENDING REVIEW
 * (the user's own food, not yet reviewed), plus EST. when values are
 * approximate (spec §10 "labelled approximately where appropriate").
 */
export function FoodSourceBadges({
  food,
  className,
}: {
  food: Pick<FoodOption, 'source' | 'isApproximate' | 'reviewStatus'>
  className?: string
}) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {food.source === 'FOOD' ? (
        <StatusBadge status="completed" label="Verified" />
      ) : (
        <ReviewBadge status={food.reviewStatus ?? 'PENDING_REVIEW'} />
      )}
      {food.isApproximate && <EstimatedTag />}
    </span>
  )
}

export function EstimatedTag() {
  return (
    <span
      className="label-mono text-muted-foreground"
      title="Approximate values"
      aria-label="Estimated values"
    >
      ≈ Est.
    </span>
  )
}

export function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status === 'APPROVED') return <StatusBadge status="completed" label="Approved" />
  if (status === 'REJECTED') return <StatusBadge status="failed" label="Rejected" />
  return <StatusBadge status="pending" label="Pending review" />
}

/** "165 KCAL · P 31 · C 0 · F 3.6 · FI 0" — compact, monospace, one line when it fits. */
export function NutritionLine({
  values,
  approximate = false,
  className,
}: {
  values: NutritionPreview
  approximate?: boolean
  className?: string
}) {
  const prefix = approximate ? '≈ ' : ''
  return (
    <p
      className={cn(
        'flex flex-wrap gap-x-3 gap-y-0.5 label-mono text-muted-foreground tabular-nums',
        className,
      )}
    >
      <span className="text-foreground-secondary">
        {prefix}
        {formatNumber(values.calories)} kcal
      </span>
      <span>P {formatNumber(values.proteinG, 1)} g</span>
      <span>C {formatNumber(values.carbsG, 1)} g</span>
      <span>F {formatNumber(values.fatG, 1)} g</span>
      <span>Fi {formatNumber(values.fiberG, 1)} g</span>
    </p>
  )
}
