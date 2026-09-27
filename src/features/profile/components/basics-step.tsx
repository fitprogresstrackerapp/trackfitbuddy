import { useMemo, useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Gender } from '@/features/auth/types'
import { ageOn, isValidIsoDate } from '@/lib/dates/local-date'

import {
  createBasicsSchema,
  EARLIEST_DATE_OF_BIRTH,
  GENDER_OPTIONS,
  type BasicsInput,
} from '../schemas'

type Field = 'name' | 'dateOfBirth' | 'gender'

interface BasicsStepProps {
  initial: { name: string | null; dateOfBirth: string | null; gender: Gender | null }
  today: string
  onSubmit: (input: BasicsInput) => Promise<void>
}

export function BasicsStep({ initial, today, onSubmit }: BasicsStepProps) {
  const [name, setName] = useState(initial.name ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(initial.dateOfBirth ?? '')
  const [gender, setGender] = useState<string>(initial.gender ?? '')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const schema = useMemo(() => createBasicsSchema(today), [today])
  const age = isValidIsoDate(dateOfBirth) && dateOfBirth < today ? ageOn(dateOfBirth, today) : null

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)

    const parsed = schema.safeParse({ name, dateOfBirth, gender })
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors({
        name: fieldErrors.name?.[0],
        dateOfBirth: fieldErrors.dateOfBirth?.[0],
        gender: fieldErrors.gender?.[0],
      })
      return
    }
    setErrors({})

    setSaving(true)
    try {
      await onSubmit(parsed.data)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save. Try again.')
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      <FormField id="name" label="Name" error={errors.name}>
        {(control) => (
          <Input
            {...control}
            autoComplete="name"
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      <FormField
        id="date-of-birth"
        label="Date of birth"
        hint={age !== null ? `Age ${age}` : 'Used to calculate your age'}
        error={errors.dateOfBirth}
      >
        {(control) => (
          <Input
            {...control}
            type="date"
            min={EARLIEST_DATE_OF_BIRTH}
            max={today}
            autoComplete="bday"
            value={dateOfBirth}
            onChange={(event) => {
              setDateOfBirth(event.target.value)
            }}
            disabled={saving}
            className="font-mono"
          />
        )}
      </FormField>

      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.gender ? 'gender-error' : undefined}
        disabled={saving}
      >
        <legend className="mb-2 label-section text-foreground-secondary">Gender</legend>
        <div className="grid grid-cols-2 gap-2">
          {GENDER_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex h-11 cursor-pointer items-center justify-center rounded-md border border-input bg-surface-1 px-3 text-center text-sm text-foreground-secondary transition-colors hover:border-foreground-secondary/40 has-checked:border-primary has-checked:bg-primary-surface has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name="gender"
                value={option.value}
                checked={gender === option.value}
                onChange={() => {
                  setGender(option.value)
                }}
                aria-invalid={Boolean(errors.gender)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
        {errors.gender && (
          <p id="gender-error" className="text-sm text-destructive">
            {errors.gender}
          </p>
        )}
      </fieldset>

      {saveError && <InlineAlert>{saveError}</InlineAlert>}

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  )
}
