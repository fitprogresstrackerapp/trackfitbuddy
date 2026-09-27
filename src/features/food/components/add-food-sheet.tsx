import { Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { InlineAlert } from '@/components/common/inline-alert'
import { Button, IconButton } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/dialog'
import { formatDayLabel } from '@/lib/dates/local-date'
import { cn } from '@/lib/utils'

import {
  existingMealFor,
  formatQuantity,
  MEAL_CATEGORIES,
  mealLabel,
  previewNutrition,
  sumPreviews,
} from '../lib/food-logic'
import type { FoodSubmissionInput } from '../schemas'
import type { DraftItem, FoodOption, LoggedMeal, MealCategory } from '../types'
import { FoodPicker } from './food-picker'
import { NutritionLine } from './food-labels'
import { QuantityStep } from './quantity-step'
import { SubmitFoodForm } from './submit-food-form'

export interface SaveMealInput {
  category: MealCategory | null
  items: readonly DraftItem[]
  existingMealId: string | null
}

interface AddFoodSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  date: string
  today: string
  /** The day's saved meals (used to add to an existing meal instead of duplicating it). */
  meals: readonly LoggedMeal[]
  /** Opened from a meal's "Add food": new foods go into that meal. */
  targetMeal: LoggedMeal | null
  /** Where the flow starts: search (default), a chosen food, or a new food. */
  start?: AddStart
  onSave: (input: SaveMealInput) => Promise<void>
  onCreateFood: (input: FoodSubmissionInput) => Promise<FoodOption>
}

/**
 * Add Food → Select Food → Select Quantity → Review → Save (spec §10).
 * Mobile: bottom sheet. Desktop: side panel. Content is remounted on open so
 * each visit starts clean.
 */
export function AddFoodSheet(props: AddFoodSheetProps) {
  const { open, onOpenChange } = props
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <AddFoodFlow {...props} />
        </SheetContent>
      )}
    </Sheet>
  )
}

export type AddStart =
  { kind: 'pick' } | { kind: 'quantity'; food: FoodOption } | { kind: 'create' }

type Step =
  | { kind: 'pick' }
  | { kind: 'quantity'; food: FoodOption; editKey?: string; quantity?: number }
  | { kind: 'create'; name: string }

let draftCounter = 0

function AddFoodFlow({
  userId,
  date,
  today,
  meals,
  targetMeal,
  start = { kind: 'pick' },
  onSave,
  onCreateFood,
}: AddFoodSheetProps) {
  const [step, setStep] = useState<Step>(
    start.kind === 'create' ? { kind: 'create', name: '' } : start,
  )
  const [draft, setDraft] = useState<DraftItem[]>([])
  const [category, setCategory] = useState<MealCategory | null>(targetMeal?.category ?? null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isPast = date < today
  const existing = targetMeal ?? (isPast ? null : existingMealFor(meals, category, today))
  const totals = sumPreviews(draft.map((item) => previewNutrition(item.food, item.quantity)))

  const title = targetMeal
    ? `Add to ${mealLabel(targetMeal)}`
    : isPast
      ? 'Add missing meal'
      : 'Add food'

  function addToDraft(food: FoodOption, quantity: number, editKey?: string) {
    setDraft((current) =>
      editKey
        ? current.map((item) => (item.key === editKey ? { ...item, quantity } : item))
        : [...current, { key: `draft-${String(++draftCounter)}`, food, quantity }],
    )
    setStep({ kind: 'pick' })
  }

  async function save() {
    if (saving || draft.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave({ category, items: draft, existingMealId: existing?.id ?? null })
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaving(false)
    }
  }

  return (
    <>
      <SheetHeader eyebrow={formatDayLabel(date)} title={title} />

      {isPast && (
        <InlineAlert tone="warning" icon={Lock} title="Locked once saved">
          This adds a missing meal to a past day. It can’t be edited or deleted after saving, so
          check the foods and quantities first.
        </InlineAlert>
      )}

      {step.kind === 'pick' && (
        <FoodPicker
          userId={userId}
          onSelect={(food) => {
            setStep({ kind: 'quantity', food })
          }}
          onCreate={(name) => {
            setStep({ kind: 'create', name })
          }}
        />
      )}
      {step.kind === 'quantity' && (
        <QuantityStep
          key={step.editKey ?? step.food.id}
          food={step.food}
          {...(step.quantity !== undefined ? { initialQuantity: step.quantity } : {})}
          submitLabel={step.editKey ? 'Update' : 'Add to meal'}
          onBack={() => {
            setStep({ kind: 'pick' })
          }}
          onSubmit={(quantity) => {
            addToDraft(step.food, quantity, step.editKey)
          }}
        />
      )}
      {step.kind === 'create' && (
        <SubmitFoodForm
          userId={userId}
          initialName={step.name}
          onBack={() => {
            setStep({ kind: 'pick' })
          }}
          onSubmit={onCreateFood}
          onCreated={(food) => {
            setStep({ kind: 'quantity', food })
          }}
        />
      )}

      {step.kind === 'pick' && (
        <section
          aria-labelledby="draft-heading"
          className="flex flex-col gap-4 border-t border-border pt-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id="draft-heading" className="label-section text-foreground-secondary">
              Review
            </h3>
            <span className="label-mono text-muted-foreground">
              {draft.length} {draft.length === 1 ? 'food' : 'foods'}
            </span>
          </div>

          {draft.length === 0 ? (
            <p className="text-sm text-muted-foreground">Select a food to add it here.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-md border border-border">
                {draft.map((item) => (
                  <li key={item.key} className="flex items-start gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-medium break-words text-foreground">
                        {item.food.name}
                      </p>
                      <p className="label-mono text-muted-foreground">
                        {formatQuantity(item.quantity, item.food.servingUnit)}
                        <span className="ml-3 text-foreground-secondary">
                          ≈ {previewNutrition(item.food, item.quantity)?.calories ?? '—'} kcal
                        </span>
                      </p>
                    </div>
                    <IconButton
                      label={`Change quantity of ${item.food.name}`}
                      icon={Pencil}
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        setStep({
                          kind: 'quantity',
                          food: item.food,
                          editKey: item.key,
                          quantity: item.quantity,
                        })
                      }}
                    />
                    <IconButton
                      label={`Remove ${item.food.name}`}
                      icon={Trash2}
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        setDraft((current) => current.filter((entry) => entry.key !== item.key))
                      }}
                    />
                  </li>
                ))}
              </ul>
              <NutritionLine values={totals} approximate />
            </>
          )}

          {!targetMeal && (
            <fieldset className="flex flex-col gap-2.5" disabled={saving}>
              <legend className="mb-2.5 label-section text-foreground-secondary">
                Category <span className="text-muted-foreground normal-case">(optional)</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {[{ value: null, label: 'None' }, ...MEAL_CATEGORIES].map((option) => {
                  const selected = category === option.value
                  return (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setCategory(option.value)
                      }}
                      className={cn(
                        'h-8 cursor-pointer rounded-xs border px-2.5 label-mono transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
                        selected
                          ? 'border-primary/60 bg-primary-surface text-foreground'
                          : 'border-border text-muted-foreground hover:border-foreground-secondary/40 hover:text-foreground-secondary',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              {existing && (
                <p className="text-xs text-muted-foreground">
                  Adds to today’s {mealLabel(existing)} instead of creating another one.
                </p>
              )}
            </fieldset>
          )}

          {saveError && <InlineAlert>{saveError}</InlineAlert>}

          <Button size="lg" disabled={draft.length === 0 || saving} onClick={() => void save()}>
            {saving
              ? 'Saving…'
              : existing
                ? `Add to ${mealLabel(existing)}`
                : isPast
                  ? 'Save missing meal'
                  : 'Save meal'}
          </Button>
        </section>
      )}
    </>
  )
}
