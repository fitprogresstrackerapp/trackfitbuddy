import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'

import { measurementsSchema, type MeasurementsInput } from '../schemas'

type Field = 'heightCm' | 'weightKg'

interface MeasurementsStepProps {
  initialHeightCm: number | null
  onBack: () => void
  onSubmit: (input: MeasurementsInput) => Promise<void>
}

export function MeasurementsStep({ initialHeightCm, onBack, onSubmit }: MeasurementsStepProps) {
  const [heightCm, setHeightCm] = useState(initialHeightCm?.toString() ?? '')
  const [weightKg, setWeightKg] = useState('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)

    const parsed = measurementsSchema.safeParse({ heightCm, weightKg })
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors({ heightCm: fieldErrors.heightCm?.[0], weightKg: fieldErrors.weightKg?.[0] })
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
      <FormField id="height" label="Height" error={errors.heightCm}>
        {(control) => (
          <AdornedInput
            {...control}
            trailing="CM"
            inputMode="decimal"
            autoComplete="off"
            value={heightCm}
            onChange={(event) => {
              setHeightCm(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      <FormField
        id="weight"
        label="Current weight"
        hint="Recorded as your first weight measurement"
        error={errors.weightKg}
      >
        {(control) => (
          <AdornedInput
            {...control}
            trailing="KG"
            inputMode="decimal"
            autoComplete="off"
            value={weightKg}
            onChange={(event) => {
              setWeightKg(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      {saveError && <InlineAlert>{saveError}</InlineAlert>}

      <div className="flex gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button type="submit" size="lg" className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Finish'}
        </Button>
      </div>
    </form>
  )
}
