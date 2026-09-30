import { useState } from 'react'

import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ACTIVITY_TYPE_LABELS } from '@/features/activity/lib/activity-types'
import { categoryLabel, MEAL_CATEGORIES } from '@/features/food/lib/food-logic'
import { ACTIVITY_LEVEL_LABELS } from '@/features/profile/lib/goals'
import { GENDER_OPTIONS } from '@/features/profile/schemas'
import { WORKOUT_TYPE_LABELS } from '@/features/workout/lib/workout-types'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatNumber, NO_VALUE } from '@/lib/format'

import type {
  ActivityLevel,
  Gender,
  InbodyRecord,
  MealCategory,
  MealItemRecord,
  MealRecord,
  StepsRecord,
  TrainingRecord,
  UserAccount,
  WeightRecord,
} from '../api/admin-data'
import { searchFoodsForCorrection } from '../api/admin-data'
import { useAdminMutations } from '../api/admin-queries'
import { correctionSchemas } from '../schemas'
import { CorrectionDialog, type ChangeLine, type ReviewedCorrection } from './admin-ui'

/*
 * Domain-specific correction forms (spec §69; no generic row editor). Each
 * form shows only its domain's fields, validates them like the server does,
 * and sends the version it was opened with: if another admin changed the
 * record meanwhile, the server refuses and asks for a refresh.
 */

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
}

type Errors = Record<string, string | undefined>

const text = (value: number | null | undefined, digits = 1, unit = '') =>
  value === null || value === undefined
    ? NO_VALUE
    : `${formatNumber(value, digits)}${unit ? ` ${unit}` : ''}`

function change(label: string, from: string, to: string): ChangeLine[] {
  return from === to ? [] : [{ label, from, to }]
}

/** Parses a set of fields; returns values or sets field errors. */
function parseFields<T extends Record<string, unknown>>(
  entries: {
    [K in keyof T]: {
      safeParse: (value: unknown) => {
        success: boolean
        data?: T[K]
        error?: { issues: { message: string }[] }
      }
    }
  },
  raw: { [K in keyof T]: string },
  setErrors: (errors: Errors) => void,
): T | null {
  const values: Partial<T> = {}
  const errors: Errors = {}
  for (const key of Object.keys(entries) as (keyof T)[]) {
    const result = entries[key].safeParse(raw[key])
    if (result.success) values[key] = result.data
    else errors[key as string] = result.error?.issues[0]?.message ?? 'Invalid value'
  }
  setErrors(errors)
  return Object.values(errors).some(Boolean) ? null : (values as T)
}

function NumberInput({
  id,
  label,
  unit,
  value,
  onChange,
  error,
}: {
  id: string
  label: string
  unit?: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
}) {
  return (
    <FormField id={id} label={unit ? `${label} (${unit})` : label} error={error}>
      {(control) => (
        <Input
          {...control}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
        />
      )}
    </FormField>
  )
}

function Choice({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <FormField id={id} label={label}>
      {(control) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...control}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  )
}

// --- Meal item ----------------------------------------------------------------

export function MealItemCorrection({ item, ...props }: DialogProps & { item: MealItemRecord }) {
  const { correct } = useAdminMutations(props.userId)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [food, setFood] = useState<{ id: string; name: string } | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string; unit: string }[]>([])
  const [errors, setErrors] = useState<Errors>({})

  const review = (): ReviewedCorrection | null => {
    const values = parseFields<{ quantity: number }>(
      { quantity: correctionSchemas.quantity },
      { quantity },
      setErrors,
    )
    if (!values) return null
    return {
      changes: [
        ...change('Food', item.name, food?.name ?? item.name),
        ...change(
          'Quantity',
          text(item.quantity, 2, item.unit),
          text(values.quantity, 2, item.unit),
        ),
      ],
      apply: (reason) =>
        correct.mutateAsync({
          correction: {
            domain: 'meal_item',
            id: item.id,
            version: item.updatedAt,
            quantity: values.quantity,
            foodItemId: food?.id ?? null,
          },
          reason,
        }),
    }
  }

  return (
    <CorrectionDialog
      {...props}
      title={`Correct ${item.name}`}
      original={[
        { label: 'Food', value: item.name },
        { label: 'Quantity', value: text(item.quantity, 2, item.unit) },
        { label: 'Calories', value: text(item.calories, 0, 'kcal') },
        { label: 'Protein', value: text(item.proteinG, 1, 'g') },
      ]}
      review={review}
    >
      <NumberInput
        id="correct-quantity"
        label="Quantity"
        unit={item.unit}
        value={quantity}
        onChange={setQuantity}
        error={errors.quantity}
      />
      <div className="flex flex-col gap-2">
        <FormField
          id="correct-food"
          label="Replace food (optional)"
          hint={
            food
              ? `Will replace with ${food.name}. The original item is kept as deleted.`
              : 'Only if the wrong food was logged. Nutrition comes from the food database.'
          }
        >
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                }}
              />
              <Button
                variant="secondary"
                disabled={query.trim().length < 2}
                onClick={() => {
                  void searchFoodsForCorrection(getSupabaseClient(), query).then(setResults)
                }}
              >
                Search
              </Button>
            </div>
          )}
        </FormField>
        {results.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => {
                    setFood({ id: result.id, name: result.name })
                    setResults([])
                  }}
                >
                  {result.name} <span className="text-muted-foreground">({result.unit})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CorrectionDialog>
  )
}

export function MealCorrection({ meal, ...props }: DialogProps & { meal: MealRecord }) {
  const { correct } = useAdminMutations(props.userId)
  const [category, setCategory] = useState<MealCategory>(meal.category ?? 'BREAKFAST')
  const label = (value: MealCategory | null) => (value === null ? NO_VALUE : categoryLabel(value))
  return (
    <CorrectionDialog
      {...props}
      title="Correct meal"
      original={[{ label: 'Meal', value: label(meal.category) }]}
      review={() => ({
        changes: change('Meal', label(meal.category), label(category)),
        apply: (reason) =>
          correct.mutateAsync({
            correction: { domain: 'meal', id: meal.id, version: meal.updatedAt, category },
            reason,
          }),
      })}
    >
      <Choice
        id="correct-meal"
        label="Meal"
        value={category}
        options={MEAL_CATEGORIES.map((entry) => ({ value: entry.value, label: entry.label }))}
        onChange={(value) => {
          setCategory(value as MealCategory)
        }}
      />
    </CorrectionDialog>
  )
}

// --- Workout / activity -------------------------------------------------------

export function TrainingCorrection({ record, ...props }: DialogProps & { record: TrainingRecord }) {
  const { correct } = useAdminMutations(props.userId)
  const labels = record.kind === 'workout' ? WORKOUT_TYPE_LABELS : ACTIVITY_TYPE_LABELS
  const [type, setType] = useState(record.type)
  const [name, setName] = useState(record.name ?? '')
  const [duration, setDuration] = useState(String(record.durationMinutes))
  const [calories, setCalories] = useState(
    record.manualCalories === null ? '' : String(record.manualCalories),
  )
  const [errors, setErrors] = useState<Errors>({})
  const typeLabel = (value: string) => labels[value] ?? value

  const review = (): ReviewedCorrection | null => {
    const values = parseFields<{ name: string | null; duration: number; calories: number | null }>(
      {
        name: correctionSchemas.customName,
        duration: correctionSchemas.duration,
        calories: correctionSchemas.manualCalories,
      },
      { name, duration, calories },
      setErrors,
    )
    if (!values) return null
    if (type === 'CUSTOM' && values.name === null) {
      setErrors({ name: 'A custom type needs a name' })
      return null
    }
    return {
      changes: [
        ...change('Type', typeLabel(record.type), typeLabel(type)),
        ...change('Name', record.name ?? NO_VALUE, values.name ?? NO_VALUE),
        ...change(
          'Duration',
          `${String(record.durationMinutes)} min`,
          `${String(values.duration)} min`,
        ),
        ...change(
          'Calories',
          record.manualCalories === null ? 'Estimated' : text(record.manualCalories, 0, 'kcal'),
          values.calories === null ? 'Estimated' : text(values.calories, 0, 'kcal'),
        ),
      ],
      apply: (reason) =>
        correct.mutateAsync({
          correction: {
            domain: 'training',
            kind: record.kind,
            id: record.id,
            version: record.updatedAt,
            type,
            name: values.name,
            durationMinutes: values.duration,
            manualCalories: values.calories,
          },
          reason,
        }),
    }
  }

  return (
    <CorrectionDialog
      {...props}
      title={`Correct ${record.kind}`}
      original={[
        { label: 'Type', value: typeLabel(record.type) },
        { label: 'Name', value: record.name ?? NO_VALUE },
        { label: 'Duration', value: `${String(record.durationMinutes)} min` },
        { label: 'Calories', value: text(record.finalCalories, 0, 'kcal') },
      ]}
      review={review}
    >
      <Choice
        id="correct-type"
        label="Type"
        value={type}
        options={Object.entries(labels).map(([value, label]) => ({ value, label }))}
        onChange={setType}
      />
      <FormField id="correct-name" label="Name (optional; required for Custom)" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            maxLength={60}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </FormField>
      <NumberInput
        id="correct-duration"
        label="Duration"
        unit="min"
        value={duration}
        onChange={setDuration}
        error={errors.duration}
      />
      <FormField
        id="correct-calories"
        label="Calories (kcal)"
        hint="Leave empty to use the estimate from type and duration."
        error={errors.calories}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="decimal"
            value={calories}
            onChange={(event) => {
              setCalories(event.target.value)
            }}
          />
        )}
      </FormField>
    </CorrectionDialog>
  )
}

// --- Steps, weight, InBody ----------------------------------------------------

export function StepsCorrection({ entry, ...props }: DialogProps & { entry: StepsRecord }) {
  const { correct } = useAdminMutations(props.userId)
  const [steps, setSteps] = useState(String(entry.steps))
  const [errors, setErrors] = useState<Errors>({})
  return (
    <CorrectionDialog
      {...props}
      title="Correct steps"
      original={[
        { label: 'Steps', value: formatNumber(entry.steps) },
        { label: 'Entry', value: entry.isActive ? 'Active value of the day' : 'Earlier entry' },
      ]}
      review={() => {
        const values = parseFields<{ steps: number }>(
          { steps: correctionSchemas.steps },
          { steps },
          setErrors,
        )
        if (!values) return null
        return {
          changes: change('Steps', formatNumber(entry.steps), formatNumber(values.steps)),
          apply: (reason) =>
            correct.mutateAsync({
              correction: {
                domain: 'steps',
                id: entry.id,
                version: entry.updatedAt,
                steps: values.steps,
              },
              reason,
            }),
        }
      }}
    >
      <NumberInput
        id="correct-steps"
        label="Steps"
        value={steps}
        onChange={setSteps}
        error={errors.steps}
      />
    </CorrectionDialog>
  )
}

export function WeightCorrection({ record, ...props }: DialogProps & { record: WeightRecord }) {
  const { correct } = useAdminMutations(props.userId)
  const [weight, setWeight] = useState(String(record.weightKg))
  const [errors, setErrors] = useState<Errors>({})
  return (
    <CorrectionDialog
      {...props}
      title="Correct weight"
      original={[
        { label: 'Weight', value: text(record.weightKg, 2, 'kg') },
        { label: 'Date', value: record.date },
      ]}
      review={() => {
        const values = parseFields<{ weight: number }>(
          { weight: correctionSchemas.weight },
          { weight },
          setErrors,
        )
        if (!values) return null
        return {
          changes: change('Weight', text(record.weightKg, 2, 'kg'), text(values.weight, 2, 'kg')),
          apply: (reason) =>
            correct.mutateAsync({
              correction: {
                domain: 'weight',
                id: record.id,
                version: record.updatedAt,
                weightKg: values.weight,
              },
              reason,
            }),
        }
      }}
    >
      <NumberInput
        id="correct-weight"
        label="Weight"
        unit="kg"
        value={weight}
        onChange={setWeight}
        error={errors.weight}
      />
    </CorrectionDialog>
  )
}

const str = (value: number | null) => (value === null ? '' : String(value))

export function InbodyCorrection({ report, ...props }: DialogProps & { report: InbodyRecord }) {
  const { correct } = useAdminMutations(props.userId)
  const metrics = report.metrics
  const [raw, setRaw] = useState({
    weight: str(metrics?.weightKg ?? null),
    fat: str(metrics?.bodyFatPercent ?? null),
    muscle: str(metrics?.muscleMassKg ?? null),
    bmi: str(metrics?.bmi ?? null),
    bmr: str(metrics?.bmrKcal ?? null),
  })
  const [errors, setErrors] = useState<Errors>({})
  if (!metrics) return null
  const set = (key: keyof typeof raw) => (value: string) => {
    setRaw((current) => ({ ...current, [key]: value }))
  }
  return (
    <CorrectionDialog
      {...props}
      title={`Correct InBody (${report.date})`}
      original={[
        { label: 'Weight', value: text(metrics.weightKg, 2, 'kg') },
        { label: 'Body fat', value: text(metrics.bodyFatPercent, 1, '%') },
        { label: 'Muscle mass', value: text(metrics.muscleMassKg, 2, 'kg') },
        { label: 'BMI', value: text(metrics.bmi, 1) },
        { label: 'BMR', value: text(metrics.bmrKcal, 0, 'kcal') },
      ]}
      review={() => {
        const values = parseFields<{
          weight: number | null
          fat: number | null
          muscle: number | null
          bmi: number | null
          bmr: number | null
        }>(
          {
            weight: correctionSchemas.inbodyWeight,
            fat: correctionSchemas.bodyFat,
            muscle: correctionSchemas.muscle,
            bmi: correctionSchemas.bmi,
            bmr: correctionSchemas.bmr,
          },
          raw,
          setErrors,
        )
        if (!values) return null
        return {
          changes: [
            ...change('Weight', text(metrics.weightKg, 2, 'kg'), text(values.weight, 2, 'kg')),
            ...change('Body fat', text(metrics.bodyFatPercent, 1, '%'), text(values.fat, 1, '%')),
            ...change(
              'Muscle mass',
              text(metrics.muscleMassKg, 2, 'kg'),
              text(values.muscle, 2, 'kg'),
            ),
            ...change('BMI', text(metrics.bmi, 1), text(values.bmi, 1)),
            ...change('BMR', text(metrics.bmrKcal, 0, 'kcal'), text(values.bmr, 0, 'kcal')),
          ],
          apply: (reason) =>
            correct.mutateAsync({
              correction: {
                domain: 'inbody',
                id: report.reportId,
                version: metrics.updatedAt,
                weightKg: values.weight,
                bodyFatPercent: values.fat,
                muscleMassKg: values.muscle,
                bmi: values.bmi,
                bmrKcal: values.bmr,
              },
              reason,
            }),
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberInput
          id="correct-inbody-weight"
          label="Weight"
          unit="kg"
          value={raw.weight}
          onChange={set('weight')}
          error={errors.weight}
        />
        <NumberInput
          id="correct-inbody-fat"
          label="Body fat"
          unit="%"
          value={raw.fat}
          onChange={set('fat')}
          error={errors.fat}
        />
        <NumberInput
          id="correct-inbody-muscle"
          label="Muscle mass"
          unit="kg"
          value={raw.muscle}
          onChange={set('muscle')}
          error={errors.muscle}
        />
        <NumberInput
          id="correct-inbody-bmi"
          label="BMI"
          value={raw.bmi}
          onChange={set('bmi')}
          error={errors.bmi}
        />
        <NumberInput
          id="correct-inbody-bmr"
          label="BMR"
          unit="kcal"
          value={raw.bmr}
          onChange={set('bmr')}
          error={errors.bmr}
        />
      </div>
    </CorrectionDialog>
  )
}

// --- Profile --------------------------------------------------------------------

const genderLabel = (value: Gender | null) =>
  GENDER_OPTIONS.find((option) => option.value === value)?.label ?? NO_VALUE
const levelLabel = (value: ActivityLevel | null) =>
  value ? (ACTIVITY_LEVEL_LABELS[value] ?? value) : 'Not set'
const NONE = 'NONE'

export function ProfileCorrection({ account, ...props }: DialogProps & { account: UserAccount }) {
  const { correct } = useAdminMutations(props.userId)
  const [name, setName] = useState(account.name ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(account.dateOfBirth ?? '')
  const [gender, setGender] = useState<Gender>(account.gender ?? 'PREFER_NOT_TO_SAY')
  const [height, setHeight] = useState(str(account.heightCm))
  const [level, setLevel] = useState<string>(account.activityLevel ?? NONE)
  const [capacity, setCapacity] = useState<string>(
    account.workoutDaysPerWeek === null ? NONE : String(account.workoutDaysPerWeek),
  )
  const [errors, setErrors] = useState<Errors>({})

  const review = (): ReviewedCorrection | null => {
    const values = parseFields<{ name: string; height: number }>(
      { name: correctionSchemas.name, height: correctionSchemas.height },
      { name, height },
      setErrors,
    )
    if (!values) return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      setErrors({ dateOfBirth: 'Enter a date of birth' })
      return null
    }
    const activityLevel = level === NONE ? null : (level as ActivityLevel)
    const workoutDays = capacity === NONE ? null : Number(capacity)
    return {
      changes: [
        ...change('Name', account.name ?? NO_VALUE, values.name),
        ...change('Date of birth', account.dateOfBirth ?? NO_VALUE, dateOfBirth),
        ...change('Gender', genderLabel(account.gender), genderLabel(gender)),
        ...change('Height', text(account.heightCm, 1, 'cm'), text(values.height, 1, 'cm')),
        ...change('Activity level', levelLabel(account.activityLevel), levelLabel(activityLevel)),
        ...change(
          'Workout capacity',
          account.workoutDaysPerWeek === null
            ? 'Not set'
            : `${String(account.workoutDaysPerWeek)} days`,
          workoutDays === null ? 'Not set' : `${String(workoutDays)} days`,
        ),
      ],
      apply: (reason) =>
        correct.mutateAsync({
          correction: {
            domain: 'profile',
            id: account.userId,
            version: account.updatedAt,
            name: values.name,
            dateOfBirth,
            gender,
            heightCm: values.height,
            activityLevel,
            workoutDaysPerWeek: workoutDays,
          },
          reason,
        }),
    }
  }

  return (
    <CorrectionDialog
      {...props}
      title="Correct profile"
      original={[
        { label: 'Name', value: account.name ?? NO_VALUE },
        { label: 'Date of birth', value: account.dateOfBirth ?? NO_VALUE },
        { label: 'Gender', value: genderLabel(account.gender) },
        { label: 'Height', value: text(account.heightCm, 1, 'cm') },
        { label: 'Activity level', value: levelLabel(account.activityLevel) },
        {
          label: 'Workout capacity',
          value:
            account.workoutDaysPerWeek === null
              ? 'Not set'
              : `${String(account.workoutDaysPerWeek)} days`,
        },
      ]}
      review={review}
    >
      <FormField id="correct-profile-name" label="Name" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
        )}
      </FormField>
      <FormField id="correct-profile-dob" label="Date of birth" error={errors.dateOfBirth}>
        {(control) => (
          <Input
            {...control}
            type="date"
            value={dateOfBirth}
            onChange={(event) => {
              setDateOfBirth(event.target.value)
            }}
          />
        )}
      </FormField>
      <Choice
        id="correct-profile-gender"
        label="Gender"
        value={gender}
        options={GENDER_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        onChange={(value) => {
          setGender(value as Gender)
        }}
      />
      <NumberInput
        id="correct-profile-height"
        label="Height"
        unit="cm"
        value={height}
        onChange={setHeight}
        error={errors.height}
      />
      <Choice
        id="correct-profile-level"
        label="Activity level"
        value={level}
        options={[
          { value: NONE, label: 'Not set' },
          ...Object.entries(ACTIVITY_LEVEL_LABELS).map(([value, label]) => ({ value, label })),
        ]}
        onChange={setLevel}
      />
      <Choice
        id="correct-profile-capacity"
        label="Workout capacity (next recommendation)"
        value={capacity}
        options={[
          { value: NONE, label: 'Not set' },
          ...[2, 3, 4, 5, 6].map((days) => ({
            value: String(days),
            label: `${String(days)} days per week`,
          })),
        ]}
        onChange={setCapacity}
      />
    </CorrectionDialog>
  )
}
