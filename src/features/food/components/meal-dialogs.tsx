import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/choice'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

import { formatQuantity, MEAL_CATEGORIES, mealLabel, sumPreviews } from '../lib/food-logic'
import { quantitySchema } from '../schemas'
import type { LoggedItem, LoggedMeal, MealCategory } from '../types'
import { NutritionLine } from './food-labels'

interface EditQuantityDialogProps {
  item: LoggedItem | null
  onOpenChange: (open: boolean) => void
  onSave: (quantity: number) => Promise<void>
}

/**
 * Quantity change for an editable item. The preview scales the item's own
 * snapshot — exactly what the database does on save (spec §12).
 */
export function EditQuantityDialog({ item, onOpenChange, onSave }: EditQuantityDialogProps) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      {item && (
        <DialogContent>
          <EditQuantityForm key={item.id} item={item} onSave={onSave} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function EditQuantityForm({
  item,
  onSave,
}: {
  item: LoggedItem
  onSave: (quantity: number) => Promise<void>
}) {
  const [value, setValue] = useState(String(item.quantity))
  const [error, setError] = useState<string | undefined>()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const parsed = quantitySchema.safeParse(value)
  const factor = parsed.success ? parsed.data / item.quantity : null
  const preview =
    factor === null
      ? null
      : sumPreviews([
          {
            calories: Math.round(item.snapshot_calories * factor),
            proteinG: item.snapshot_protein_g * factor,
            carbsG: item.snapshot_carbs_g * factor,
            fatG: item.snapshot_fat_g * factor,
            fiberG: item.snapshot_fiber_g * factor,
          },
        ])

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!parsed.success) {
      setError(z.flattenError(parsed.error).formErrors[0])
      return
    }
    setError(undefined)
    setSaveError(null)
    setSaving(true)
    try {
      await onSave(parsed.data)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <DialogHeader
        eyebrow="Edit quantity"
        title={item.foodName}
        description={`Currently ${formatQuantity(item.quantity, item.unit)}.`}
      />
      <FormField id="edit-quantity" label="Quantity" error={error}>
        {(control) => (
          <AdornedInput
            {...control}
            trailing={item.unit.toUpperCase()}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      {preview && <NutritionLine values={preview} approximate />}
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={saving}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface ConfirmDeleteMealDialogProps {
  meal: LoggedMeal | null
  dayLabel: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
}

/** Deleting a meal always asks first (it removes every food in it). */
export function ConfirmDeleteMealDialog({
  meal,
  dayLabel,
  onOpenChange,
  onConfirm,
}: ConfirmDeleteMealDialogProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = meal?.meal_items.length ?? 0

  return (
    <Dialog
      open={meal !== null}
      onOpenChange={(open) => {
        if (!open) setError(null)
        onOpenChange(open)
      }}
    >
      {meal && (
        <DialogContent role="alertdialog">
          <DialogHeader
            eyebrow="Delete meal"
            title={`Delete ${mealLabel(meal)}?`}
            description={`This removes the meal and its ${count === 1 ? 'food' : `${String(count)} foods`} from ${dayLabel}.`}
          />
          {error && <InlineAlert>{error}</InlineAlert>}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" disabled={working}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={working}
              onClick={() => {
                setWorking(true)
                setError(null)
                onConfirm()
                  .catch((caught: unknown) => {
                    setError(caught instanceof Error ? caught.message : String(caught))
                  })
                  .finally(() => {
                    setWorking(false)
                  })
              }}
            >
              {working ? 'Deleting…' : 'Delete meal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

const NO_CATEGORY = 'NONE'

interface CategoryDialogProps {
  meal: LoggedMeal | null
  onOpenChange: (open: boolean) => void
  onSave: (category: MealCategory | null) => Promise<void>
}

export function CategoryDialog({ meal, onOpenChange, onSave }: CategoryDialogProps) {
  return (
    <Dialog open={meal !== null} onOpenChange={onOpenChange}>
      {meal && (
        <DialogContent>
          <CategoryForm key={meal.id} meal={meal} onSave={onSave} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function CategoryForm({
  meal,
  onSave,
}: {
  meal: LoggedMeal
  onSave: (category: MealCategory | null) => Promise<void>
}) {
  const [value, setValue] = useState<string>(meal.category ?? NO_CATEGORY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const category = MEAL_CATEGORIES.find((entry) => entry.value === value)?.value ?? null
      await onSave(category)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <DialogHeader
        eyebrow="Meal category"
        title={mealLabel(meal)}
        description="Categories are optional."
      />
      <RadioGroup value={value} onValueChange={setValue} aria-label="Category" disabled={saving}>
        {[...MEAL_CATEGORIES, { value: NO_CATEGORY, label: 'No category' }].map((option) => (
          <div key={option.value} className="flex items-center gap-3">
            <RadioGroupItem value={option.value} id={`category-${option.value}`} />
            <Label htmlFor={`category-${option.value}`} className="cursor-pointer">
              {option.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {error && <InlineAlert>{error}</InlineAlert>}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="secondary" disabled={saving}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}
