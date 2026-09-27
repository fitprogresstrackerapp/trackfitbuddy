import { Section } from '@/components/layout/page'

import { formatQuantity, previewNutrition } from '../lib/food-logic'
import type { FoodSubmission } from '../types'
import { NutritionLine, ReviewBadge } from './food-labels'

/** The user's own submitted foods and their review status (spec §11). */
export function MyFoods({ submissions }: { submissions: readonly FoodSubmission[] }) {
  if (submissions.length === 0) return null
  return (
    <Section title="My foods" meta={`${String(submissions.length)} submitted`}>
      <ul className="divide-y divide-border border-y border-border">
        {submissions.map((food) => {
          const values = previewNutrition(food, food.servingQuantity)
          return (
            <li key={food.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium break-words text-foreground">{food.name}</span>
                <span className="label-mono text-muted-foreground">
                  {formatQuantity(food.servingQuantity, food.servingUnit)}
                </span>
                <ReviewBadge status={food.status} />
              </div>
              {values && <NutritionLine values={values} />}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
