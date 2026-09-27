import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useFoodSearch } from '../api/food-queries'
import { formatQuantity } from '../lib/food-logic'
import {
  foodSubmissionSchema,
  type FoodSubmissionField,
  type FoodSubmissionInput,
} from '../schemas'
import type { FoodOption } from '../types'

interface SubmitFoodFormProps {
  userId: string
  initialName: string
  onBack: () => void
  /** Saves the submission; resolves to the new (pending) food. */
  onSubmit: (input: FoodSubmissionInput) => Promise<FoodOption>
  onCreated: (food: FoodOption) => void
}

const NUTRIENTS: readonly { field: FoodSubmissionField; label: string; unit: string }[] = [
  { field: 'calories', label: 'Calories', unit: 'KCAL' },
  { field: 'proteinG', label: 'Protein', unit: 'G' },
  { field: 'carbsG', label: 'Carbs', unit: 'G' },
  { field: 'fatG', label: 'Fat', unit: 'G' },
  { field: 'fiberG', label: 'Fiber', unit: 'G' },
]

type Values = Record<FoodSubmissionField, string>

/**
 * User-created food (spec §11). Saved as PENDING REVIEW, usable by its
 * submitter immediately, shared only after an admin approves it. Similar
 * existing foods are shown as a non-blocking warning — never merged here.
 */
export function SubmitFoodForm({
  userId,
  initialName,
  onBack,
  onSubmit,
  onCreated,
}: SubmitFoodFormProps) {
  const [values, setValues] = useState<Values>({
    name: initialName,
    servingQuantity: '1',
    servingUnit: 'serving',
    calories: '',
    proteinG: '',
    carbsG: '',
    fatG: '',
    fiberG: '',
  })
  const [errors, setErrors] = useState<Partial<Record<FoodSubmissionField, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const similar = useFoodSearch(userId, values.name)
  const duplicates = similar.active ? (similar.data ?? []).slice(0, 3) : []

  function update(field: FoodSubmissionField, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = foodSubmissionSchema.safeParse(values)
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors(
        Object.fromEntries(
          Object.entries(fieldErrors).map(([field, messages]) => [field, messages[0]]),
        ),
      )
      return
    }
    setErrors({})
    setSaving(true)
    try {
      onCreated(await onSubmit(parsed.data))
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <p className="text-sm text-foreground-secondary">
        Enter values for one serving. Your food is reviewed before it’s shared; you can log it right
        away.
      </p>

      <FormField id="new-food-name" label="Food name" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            value={values.name}
            maxLength={120}
            onChange={(event) => {
              update('name', event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      {duplicates.length > 0 && (
        <InlineAlert tone="info" title="A similar food already exists">
          <span className="block">
            {duplicates
              .map(
                (food) =>
                  `${food.name} (${formatQuantity(food.servingQuantity, food.servingUnit)})`,
              )
              .join(', ')}
            . You can still submit this food for review.
          </span>
        </InlineAlert>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField id="new-food-serving" label="Serving size" error={errors.servingQuantity}>
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              autoComplete="off"
              value={values.servingQuantity}
              onChange={(event) => {
                update('servingQuantity', event.target.value)
              }}
              disabled={saving}
            />
          )}
        </FormField>
        <FormField
          id="new-food-unit"
          label="Unit"
          hint="g, ml, piece, bowl…"
          error={errors.servingUnit}
        >
          {(control) => (
            <Input
              {...control}
              autoComplete="off"
              maxLength={20}
              value={values.servingUnit}
              onChange={(event) => {
                update('servingUnit', event.target.value)
              }}
              disabled={saving}
            />
          )}
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {NUTRIENTS.map((nutrient) => (
          <FormField
            key={nutrient.field}
            id={`new-food-${nutrient.field}`}
            label={nutrient.label}
            error={errors[nutrient.field]}
          >
            {(control) => (
              <AdornedInput
                {...control}
                trailing={nutrient.unit}
                inputMode="decimal"
                autoComplete="off"
                value={values[nutrient.field]}
                onChange={(event) => {
                  update(nutrient.field, event.target.value)
                }}
                disabled={saving}
              />
            )}
          </FormField>
        ))}
      </div>

      {saveError && <InlineAlert>{saveError}</InlineAlert>}

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Create food'}
        </Button>
      </div>
    </form>
  )
}
