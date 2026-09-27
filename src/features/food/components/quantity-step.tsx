import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { formatQuantity, previewNutrition, quantityPresets } from '../lib/food-logic'
import { quantitySchema } from '../schemas'
import type { FoodOption } from '../types'
import { FoodSourceBadges, NutritionLine } from './food-labels'

interface QuantityStepProps {
  food: FoodOption
  initialQuantity?: number
  submitLabel: string
  onBack: () => void
  onSubmit: (quantity: number) => void
}

/**
 * Select Quantity (spec §10). The unit is always the food's own serving unit —
 * no invented conversions. The preview is approximate; the database computes
 * the stored values from the same food and quantity.
 */
export function QuantityStep({
  food,
  initialQuantity,
  submitLabel,
  onBack,
  onSubmit,
}: QuantityStepProps) {
  const [value, setValue] = useState(String(initialQuantity ?? food.servingQuantity))
  const [error, setError] = useState<string | undefined>()
  const parsed = quantitySchema.safeParse(value)
  const preview = parsed.success ? previewNutrition(food, parsed.data) : null

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsed.success) {
      setError(z.flattenError(parsed.error).formErrors[0])
      return
    }
    onSubmit(parsed.data)
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="heading-block break-words text-foreground">{food.name}</h3>
          <FoodSourceBadges food={food} />
        </div>
        <p className="label-mono text-muted-foreground">
          Per {formatQuantity(food.servingQuantity, food.servingUnit)}
        </p>
        {food.source === 'SUBMISSION' && (
          <p className="text-xs text-muted-foreground">
            Your food is waiting for review. You can log it now.
          </p>
        )}
      </div>

      <FormField
        id="food-quantity"
        label="Quantity"
        hint={`Unit: ${food.servingUnit} (this food’s serving unit)`}
        error={error}
      >
        {(control) => (
          <AdornedInput
            {...control}
            trailing={food.servingUnit.toUpperCase()}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setError(undefined)
            }}
          />
        )}
      </FormField>

      <div role="group" aria-label="Quick quantities" className="flex flex-wrap gap-2">
        {quantityPresets(food.servingQuantity).map((preset) => {
          const selected = parsed.success && parsed.data === preset
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setValue(String(preset))
                setError(undefined)
              }}
              className={cn(
                'h-8 cursor-pointer rounded-xs border px-2.5 label-mono transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected
                  ? 'border-primary/60 bg-primary-surface text-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground-secondary/40 hover:text-foreground-secondary',
              )}
            >
              {formatQuantity(preset, food.servingUnit)}
            </button>
          )
        })}
      </div>

      <div className="space-y-1.5 rounded-sm border border-border bg-background/40 px-3 py-2.5">
        <p className="label-mono text-muted-foreground">Estimate from food data</p>
        {preview ? (
          <NutritionLine values={preview} approximate />
        ) : (
          <p className="label-mono text-muted-foreground">—</p>
        )}
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" className="flex-1">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
