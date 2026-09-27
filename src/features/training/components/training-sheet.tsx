import { Lock } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/choice'
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/dialog'
import { DatePicker, Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LATE_ENTRY_DAYS } from '@/lib/dates/day-param'
import { addDays, formatDayLabel } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { useCalorieRates } from '../api/training-queries'
import { typeOptions } from '../lib/labels'
import { estimateCalories } from '../lib/training'
import {
  createTrainingSchema,
  type TrainingField,
  type TrainingFormValues,
  type TrainingInput,
} from '../schemas'
import type { TrainingKind, TrainingRecord } from '../types'

export type TrainingSheetMode =
  | { kind: TrainingKind; action: 'create'; date: string }
  | { kind: TrainingKind; action: 'edit'; record: TrainingRecord }

interface TrainingSheetProps {
  mode: TrainingSheetMode | null
  today: string
  onOpenChange: (open: boolean) => void
  onSubmit: (values: TrainingInput) => Promise<void>
}

/**
 * Log or edit a workout/activity. Mobile: bottom sheet; desktop: side panel.
 * Remounted per opening, so each visit starts clean.
 */
export function TrainingSheet({ mode, today, onOpenChange, onSubmit }: TrainingSheetProps) {
  return (
    <Sheet open={mode !== null} onOpenChange={onOpenChange}>
      {mode && (
        <SheetContent>
          <TrainingForm mode={mode} today={today} onSubmit={onSubmit} />
        </SheetContent>
      )}
    </Sheet>
  )
}

const DURATION_PRESETS = [30, 45, 60, 90]

const COPY: Record<TrainingKind, { noun: string; typeLabel: string; estimateNote: string }> = {
  workout: {
    noun: 'workout',
    typeLabel: 'Workout type',
    estimateNote: 'Estimated based on the default workout assumption. Actual expenditure may vary.',
  },
  activity: {
    noun: 'activity',
    typeLabel: 'Activity',
    estimateNote: 'Estimated from a typical rate for this activity. Actual expenditure may vary.',
  },
}

function initialValues(mode: TrainingSheetMode): TrainingFormValues {
  if (mode.action === 'edit') {
    const { record } = mode
    return {
      type: record.type,
      name: record.name ?? '',
      duration: String(record.durationMinutes),
      manual: record.manualCalories !== null,
      manualCalories: record.manualCalories === null ? '' : String(record.manualCalories),
      date: record.date,
    }
  }
  return {
    type: mode.kind === 'workout' ? 'UPPER_BODY' : 'WALKING',
    name: '',
    duration: '',
    manual: false,
    manualCalories: '',
    date: mode.date,
  }
}

function TrainingForm({
  mode,
  today,
  onSubmit,
}: {
  mode: TrainingSheetMode
  today: string
  onSubmit: (values: TrainingInput) => Promise<void>
}) {
  const { kind } = mode
  const copy = COPY[kind]
  const [values, setValues] = useState<TrainingFormValues>(() => initialValues(mode))
  const [errors, setErrors] = useState<Partial<Record<TrainingField, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rates = useCalorieRates(true)

  const editing = mode.action === 'edit' ? mode.record : null
  const duration = /^\d+$/.test(values.duration.trim()) ? Number(values.duration) : Number.NaN
  // An unchanged record keeps its stored estimate (never recalculated on read).
  const unchanged =
    editing !== null && editing.type === values.type && editing.durationMinutes === duration
  const estimate = unchanged
    ? editing.estimatedCalories
    : rates.data
      ? estimateCalories(rates.data, kind, values.type, duration)
      : null
  const isPast = values.date < today
  const idPrefix = `training-${kind}`

  function update<K extends TrainingField>(field: K, value: TrainingFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = createTrainingSchema(kind, today).safeParse(values)
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
      await onSubmit(parsed.data)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <SheetHeader
        eyebrow={formatDayLabel(values.date)}
        title={editing ? `Edit ${copy.noun}` : `Log ${copy.noun}`}
      />

      <FormField id={`${idPrefix}-type`} label={copy.typeLabel} error={errors.type}>
        {(control) => (
          <Select
            value={values.type}
            onValueChange={(value) => {
              update('type', value)
            }}
            disabled={saving}
          >
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeOptions(kind).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>

      <FormField
        id={`${idPrefix}-name`}
        label={values.type === 'CUSTOM' ? 'Name' : 'Name (optional)'}
        hint={kind === 'workout' ? 'e.g. Push Strength' : 'e.g. Evening walk'}
        error={errors.name}
      >
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            maxLength={60}
            value={values.name}
            onChange={(event) => {
              update('name', event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      <div className="flex flex-col gap-2.5">
        <FormField id={`${idPrefix}-duration`} label="Duration" error={errors.duration}>
          {(control) => (
            <AdornedInput
              {...control}
              trailing="MIN"
              inputMode="numeric"
              autoComplete="off"
              value={values.duration}
              onChange={(event) => {
                update('duration', event.target.value)
              }}
              disabled={saving}
            />
          )}
        </FormField>
        <div role="group" aria-label="Quick durations" className="flex flex-wrap gap-2">
          {DURATION_PRESETS.map((preset) => {
            const selected = duration === preset
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={selected}
                disabled={saving}
                onClick={() => {
                  update('duration', String(preset))
                }}
                className={cn(
                  'h-8 cursor-pointer rounded-xs border px-2.5 label-mono transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45',
                  selected
                    ? 'border-primary/60 bg-primary-surface text-foreground'
                    : 'border-border text-muted-foreground hover:border-foreground-secondary/40 hover:text-foreground-secondary',
                )}
              >
                {preset} min
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-sm border border-border bg-background/40 px-3 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label-mono text-muted-foreground">Estimated calories</span>
          <span className="text-sm text-foreground tabular-nums">
            {estimate === null ? '—' : `≈ ${formatNumber(estimate)} kcal`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{copy.estimateNote}</p>
        <div className="flex items-center gap-2.5">
          <Checkbox
            id={`${idPrefix}-manual`}
            checked={values.manual}
            onCheckedChange={(checked) => {
              update('manual', checked === true)
            }}
            disabled={saving}
          />
          <Label htmlFor={`${idPrefix}-manual`} className="cursor-pointer">
            Manual calorie override
          </Label>
        </div>
        {values.manual && (
          <FormField
            id={`${idPrefix}-calories`}
            label="Calories"
            hint="Used instead of the estimate."
            error={errors.manualCalories}
          >
            {(control) => (
              <AdornedInput
                {...control}
                trailing="KCAL"
                inputMode="decimal"
                autoComplete="off"
                value={values.manualCalories}
                onChange={(event) => {
                  update('manualCalories', event.target.value)
                }}
                disabled={saving}
              />
            )}
          </FormField>
        )}
      </div>

      <FormField
        id={`${idPrefix}-date`}
        label="Date"
        {...(editing ? { hint: 'The date of a saved entry can’t be changed.' } : {})}
        error={errors.date}
      >
        {(control) => (
          <DatePicker
            {...control}
            value={values.date}
            max={today}
            min={addDays(today, -LATE_ENTRY_DAYS)}
            onChange={(event) => {
              update('date', event.target.value)
            }}
            disabled={saving || editing !== null}
          />
        )}
      </FormField>

      {isPast && !editing && (
        <InlineAlert tone="warning" icon={Lock} title="Locked once saved">
          This adds a missing {copy.noun} to a past day. It can’t be edited or deleted after saving.
        </InlineAlert>
      )}

      {saveError && <InlineAlert>{saveError}</InlineAlert>}

      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : editing ? 'Save changes' : `Log ${copy.noun}`}
      </Button>
    </form>
  )
}
