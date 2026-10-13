import { useRef, useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/choice'
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { hasEnergyMismatch, macroEnergy } from '@/features/food/lib/food-quality'
import {
  foodSubmissionSchema,
  type FoodSubmissionField,
  type FoodSubmissionInput,
} from '@/features/food/schemas'
import { notify } from '@/lib/feedback'
import { formatNumber } from '@/lib/format'

import type { FoodAdminRow, FoodDuplicate } from '../api/food-admin-data'
import { useFoodAdminMutations, useFoodDuplicates } from '../api/food-admin-queries'
import { friendlyAdminError } from '../lib/admin-logic'
import {
  EMPTY_FOOD_FORM,
  FOOD_STATUS_LABELS,
  formatDay,
  servingBasis,
  toFormValues,
} from '../lib/food-admin-logic'
import { Facts, ReasonField } from './admin-ui'

export type FoodSheetTarget =
  { mode: 'create' } | { mode: 'edit'; food: FoodAdminRow } | { mode: 'review'; food: FoodAdminRow }

const NUTRIENTS: readonly { field: FoodSubmissionField; label: string; unit: string }[] = [
  { field: 'calories', label: 'Calories', unit: 'KCAL' },
  { field: 'proteinG', label: 'Protein', unit: 'G' },
  { field: 'carbsG', label: 'Carbs', unit: 'G' },
  { field: 'fatG', label: 'Fat', unit: 'G' },
  { field: 'fiberG', label: 'Fiber', unit: 'G' },
]

type Values = Record<FoodSubmissionField, string>
type Errors = Partial<Record<FoodSubmissionField, string>>

const TITLES = { create: 'Add food', edit: 'Edit food', review: 'Review food' } as const

/** Add, edit or review a food. Editing lives in a sheet, as elsewhere in admin. */
export function FoodSheet({
  target,
  onClose,
}: {
  target: FoodSheetTarget | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {target && (
        <SheetContent>
          <SheetHeader
            eyebrow="Food database"
            title={TITLES[target.mode]}
            description={
              target.mode === 'review'
                ? 'A food created by a user. Check it before it is shared with everyone.'
                : 'Shared with all users. Values are for one serving, as entered.'
            }
          />
          {target.mode === 'review' && target.food.status !== 'PENDING_REVIEW' ? (
            <ReviewedSummary food={target.food} />
          ) : (
            <FoodForm
              key={target.mode === 'create' ? 'new' : target.food.id}
              target={target}
              onClose={onClose}
            />
          )}
        </SheetContent>
      )}
    </Sheet>
  )
}

function basisLine(values: Values): string {
  const quantity = Number(values.servingQuantity)
  return Number.isFinite(quantity) && quantity > 0 && values.servingUnit.trim()
    ? `Nutrition ${servingBasis({ servingQuantity: quantity, servingUnit: values.servingUnit.trim() })}`
    : 'Nutrition per serving'
}

function FoodForm({ target, onClose }: { target: FoodSheetTarget; onClose: () => void }) {
  const mutations = useFoodAdminMutations()
  const existing = target.mode === 'create' ? null : target.food
  const [values, setValues] = useState<Values>(existing ? toFormValues(existing) : EMPTY_FOOD_FORM)
  const [isApproximate, setApproximate] = useState(existing?.isApproximate ?? true)
  const [active, setActive] = useState(true)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Calories far from the macros: shown once, then the admin may save anyway.
  const [mismatchShown, setMismatchShown] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  // Also a ref: two clicks in the same frame both see the old state.
  const busy = useRef(false)

  const duplicates = useFoodDuplicates(values.name, target.mode === 'edit' ? target.food.id : null)
  const exact = (duplicates.data ?? []).find((food) => food.isExact && food.status === 'ACTIVE')

  function update(field: FoodSubmissionField, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setMismatchShown(false)
  }

  function validate(): FoodSubmissionInput | null {
    const parsed = foodSubmissionSchema.safeParse(values)
    if (parsed.success) {
      setErrors({})
      return parsed.data
    }
    const { fieldErrors } = z.flattenError(parsed.error)
    setErrors(
      Object.fromEntries(
        Object.entries(fieldErrors).map(([field, messages]) => [field, messages[0]]),
      ),
    )
    return null
  }

  async function run(action: () => Promise<unknown>, done: string, fallback: string) {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setSaveError(null)
    try {
      await action()
      notify.success(done, 'Recorded in the audit log.')
      onClose()
    } catch (caught) {
      setSaveError(friendlyAdminError(caught, fallback))
      setSaving(false)
      busy.current = false
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current) return
    setSaveError(null)
    const parsed = validate()
    if (!parsed) return
    const mismatch = hasEnergyMismatch({
      calories: parsed.calories,
      protein_g: parsed.proteinG,
      carbs_g: parsed.carbsG,
      fat_g: parsed.fatG,
    })
    if (mismatch && !mismatchShown) {
      setMismatchShown(true)
      return
    }
    const input = { values: parsed, isApproximate }
    const reason = note.trim() || null
    if (target.mode === 'create') {
      await run(
        () => mutations.create.mutateAsync({ ...input, active }),
        'Food added',
        'Couldn’t add the food. Please try again.',
      )
    } else if (target.mode === 'edit') {
      await run(
        () =>
          mutations.update.mutateAsync({
            ...input,
            id: target.food.id,
            version: target.food.updatedAt,
            reason,
          }),
        'Food updated',
        'Couldn’t save the food. Please try again.',
      )
    } else {
      await run(
        () =>
          mutations.approve.mutateAsync({
            ...input,
            id: target.food.id,
            version: target.food.updatedAt,
            notes: reason,
          }),
        'Food approved',
        'Couldn’t approve the food. Please try again.',
      )
    }
  }

  const implied = macroEnergy({
    protein_g: Number(values.proteinG) || 0,
    carbs_g: Number(values.carbsG) || 0,
    fat_g: Number(values.fatG) || 0,
  })

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      {target.mode === 'review' && <Submitted food={target.food} />}

      <FormField id="food-name" label="Food name" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            maxLength={120}
            value={values.name}
            onChange={(event) => {
              update('name', event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      <Duplicates foods={duplicates.data ?? []} exact={exact !== undefined} />

      <div className="grid grid-cols-2 gap-4">
        <FormField id="food-serving" label="Serving size" error={errors.servingQuantity}>
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
          id="food-unit"
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

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 label-mono text-muted-foreground">{basisLine(values)}</legend>
        <div className="grid grid-cols-2 gap-4">
          {NUTRIENTS.map((nutrient) => (
            <FormField
              key={nutrient.field}
              id={`food-${nutrient.field}`}
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
      </fieldset>

      <CheckRow
        id="food-approximate"
        checked={isApproximate}
        onChange={setApproximate}
        disabled={saving}
        label="Approximate values"
        hint="Shown to users as “≈ Est.”. Untick only for values from a label or a trusted reference."
      />
      {target.mode === 'create' && (
        <CheckRow
          id="food-active"
          checked={active}
          onChange={setActive}
          disabled={saving}
          label="Active"
          hint="Active foods can be found and logged by every user."
        />
      )}

      {target.mode === 'edit' && (
        <>
          <p className="text-sm text-foreground-secondary">
            Meals already logged keep the values they were logged with. New logs use the values
            saved here.
          </p>
          <ReasonField id="food-reason" value={note} onChange={setNote} disabled={saving} />
        </>
      )}
      {target.mode === 'review' && (
        <FormField
          id="food-review-note"
          label="Review note"
          hint="Optional. Kept with the submission and in the audit log."
        >
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
              }}
              disabled={saving}
            />
          )}
        </FormField>
      )}

      {mismatchShown && (
        <InlineAlert tone="warning" title="Check the calories">
          The macros add up to about {formatNumber(implied)} kcal, which is far from the calories
          entered. Nothing was changed. Correct a value, or save again to keep these values.
        </InlineAlert>
      )}
      {saveError && <InlineAlert>{saveError}</InlineAlert>}

      {rejecting && target.mode === 'review' ? (
        <div className="flex flex-col gap-3">
          <InlineAlert tone="warning" title="Reject this food?">
            It will not be shared and its creator can no longer log it. Meals already logged with it
            are kept. The record stays for the audit history.
          </InlineAlert>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setRejecting(false)
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={saving}
              onClick={() =>
                void run(
                  () =>
                    mutations.reject.mutateAsync({
                      id: target.food.id,
                      version: target.food.updatedAt,
                      notes: note.trim() || null,
                    }),
                  'Food rejected',
                  'Couldn’t reject the food. Please try again.',
                )
              }
            >
              {saving ? 'Working…' : 'Reject food'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          {target.mode === 'review' && (
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setSaveError(null)
                setRejecting(true)
              }}
            >
              Reject
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" disabled={saving}>
            {saving
              ? 'Saving…'
              : mismatchShown
                ? 'Save anyway'
                : target.mode === 'create'
                  ? 'Add food'
                  : target.mode === 'edit'
                    ? 'Save changes'
                    : 'Approve'}
          </Button>
        </div>
      )}
    </form>
  )
}

function CheckRow({
  id,
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled: boolean
  label: string
  hint: string
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={(next) => {
          onChange(next === true)
        }}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-sm text-foreground">
          {label}
        </label>
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
    </div>
  )
}

const valuesLine = (food: FoodDuplicate | FoodAdminRow) =>
  `${formatNumber(food.calories, 1)} kcal · P ${formatNumber(food.proteinG, 1)} · C ${formatNumber(food.carbsG, 1)} · F ${formatNumber(food.fatG, 1)} · Fi ${formatNumber(food.fiberG, 1)}`

/** Likely duplicates. The admin decides; nothing is merged or blocked here. */
function Duplicates({ foods, exact }: { foods: readonly FoodDuplicate[]; exact: boolean }) {
  if (foods.length === 0) return null
  return (
    <InlineAlert
      tone={exact ? 'warning' : 'info'}
      title={exact ? 'A food with this name already exists' : 'Possible existing foods'}
    >
      <ul className="flex flex-col gap-1.5">
        {foods.map((food) => (
          <li key={food.id} className="flex flex-col">
            <span className="text-foreground">
              {food.name}
              {food.status === 'INACTIVE' ? ' (inactive)' : ''}
            </span>
            <span className="label-mono text-muted-foreground">
              {servingBasis(food)} · {valuesLine(food)}
            </span>
          </li>
        ))}
      </ul>
      {exact && (
        <p className="pt-1.5">Use a more specific name, or reject this one as a duplicate.</p>
      )}
    </InlineAlert>
  )
}

/** What the user submitted, unchanged, above the values the admin may correct. */
function Submitted({ food }: { food: FoodAdminRow }) {
  return (
    <section aria-label="Submitted" className="flex flex-col gap-2">
      <h3 className="label-section text-foreground-secondary">Submitted</h3>
      <Facts
        items={[
          { label: 'Food', value: food.name },
          { label: 'Created by', value: food.submittedByName ?? 'A user' },
          { label: 'Created', value: formatDay(food.createdAt) },
          { label: 'Serving', value: servingBasis(food).replace(/^per /, '') },
          { label: 'Nutrition', value: valuesLine(food) },
          { label: 'Source', value: 'User-created (not verified)' },
        ]}
      />
    </section>
  )
}

/** A submission that has already been reviewed: read-only. */
function ReviewedSummary({ food }: { food: FoodAdminRow }) {
  return (
    <div className="flex flex-col gap-5">
      <Submitted food={food} />
      <Facts
        items={[
          { label: 'Status', value: FOOD_STATUS_LABELS[food.status] },
          { label: 'Reviewed', value: formatDay(food.updatedAt) },
          { label: 'Review note', value: food.notes ?? '—' },
        ]}
      />
      <p className="text-sm text-foreground-secondary">
        This food is not shared and can no longer be logged. Meals already logged with it are kept.
      </p>
    </div>
  )
}
