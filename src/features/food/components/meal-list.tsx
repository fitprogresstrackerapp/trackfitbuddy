import { Copy, Ellipsis, Pencil, Plus, Tag, Trash2 } from 'lucide-react'

import { StatusBadge } from '@/components/data/status-badge'
import { IconButton } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/lib/format'

import { formatQuantity, isEditable, mealLabel, mealTotals } from '../lib/food-logic'
import type { LoggedItem, LoggedMeal } from '../types'
import { EstimatedTag, NutritionLine } from './food-labels'

export interface MealActions {
  onAddFood: (meal: LoggedMeal) => void
  onEditItem: (meal: LoggedMeal, item: LoggedItem) => void
  onDeleteItem: (meal: LoggedMeal, item: LoggedItem) => void
  onDeleteMeal: (meal: LoggedMeal) => void
  onChangeCategory: (meal: LoggedMeal) => void
  onCopy: (meal: LoggedMeal) => void
}

interface MealListProps extends MealActions {
  meals: readonly LoggedMeal[]
  today: string
  /** Item ids with a change in flight (their controls are disabled). */
  busyIds: ReadonlySet<string>
}

export function MealList({ meals, today, busyIds, ...actions }: MealListProps) {
  return (
    <div className="flex flex-col gap-4">
      {meals.map((meal) => (
        <MealBlock key={meal.id} meal={meal} today={today} busyIds={busyIds} {...actions} />
      ))}
    </div>
  )
}

function MealBlock({
  meal,
  today,
  busyIds,
  onAddFood,
  onEditItem,
  onDeleteItem,
  onDeleteMeal,
  onChangeCategory,
  onCopy,
}: MealActions & { meal: LoggedMeal; today: string; busyIds: ReadonlySet<string> }) {
  const editable = isEditable(meal, today)
  const label = mealLabel(meal)
  const totals = mealTotals(meal)
  const busy = busyIds.has(meal.id)
  const headingId = `meal-${meal.id}`

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-md border border-border bg-surface-1"
      aria-busy={busy || undefined}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="heading-block text-foreground">
              {label}
            </h3>
            {!editable && <StatusBadge status="locked" />}
            {meal.copiedFromMealId && (
              <span className="label-mono text-muted-foreground">Copied</span>
            )}
          </div>
          <NutritionLine values={totals} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`${label} actions`} icon={Ellipsis} size="sm" disabled={busy} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {editable && (
              <>
                <DropdownMenuItem
                  onSelect={() => {
                    onAddFood(meal)
                  }}
                >
                  <Plus />
                  Add food
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    onChangeCategory(meal)
                  }}
                >
                  <Tag />
                  Change category
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              onSelect={() => {
                onCopy(meal)
              }}
            >
              <Copy />
              {meal.date === today ? 'Copy as new meal' : 'Copy to today'}
            </DropdownMenuItem>
            {editable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  tone="destructive"
                  onSelect={() => {
                    onDeleteMeal(meal)
                  }}
                >
                  <Trash2 />
                  Delete meal
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <ul className="divide-y divide-border">
        {meal.meal_items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium break-words text-foreground">
                  {item.foodName}
                </span>
                {item.isUserFood && (
                  <span className="label-mono text-muted-foreground">My food</span>
                )}
                {item.isApproximate && <EstimatedTag />}
              </div>
              <p className="label-mono text-muted-foreground">
                {formatQuantity(item.quantity, item.unit)}
                <span className="sr-only">,</span>
                <span className="ml-3 text-foreground-secondary">
                  {formatNumber(item.snapshot_calories)} kcal
                </span>
                <span className="ml-3">P {formatNumber(item.snapshot_protein_g, 1)} g</span>
              </p>
            </div>
            {editable && (
              <div className="-mr-1.5 flex shrink-0 items-center">
                <IconButton
                  label={`Edit quantity of ${item.foodName}`}
                  icon={Pencil}
                  size="sm"
                  disabled={busy || busyIds.has(item.id)}
                  onClick={() => {
                    onEditItem(meal, item)
                  }}
                />
                <IconButton
                  label={`Remove ${item.foodName}`}
                  icon={Trash2}
                  size="sm"
                  disabled={busy || busyIds.has(item.id)}
                  onClick={() => {
                    onDeleteItem(meal, item)
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </article>
  )
}
