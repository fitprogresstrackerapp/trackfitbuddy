import type { UseQueryResult } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SegmentedControl } from '@/components/ui/tabs'
import { formatShortDate } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'
import { cn } from '@/lib/utils'

import type { GoalDetails, PlanData, ProfileDetails } from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { FOCUS_TYPES, focusLabel, LONG_TERM_GOALS, longTermGoalLabel } from '../lib/goals'
import { friendlyProfileError } from '../lib/profile-logic'
import { goalSchema, OBJECTIVE_MAX, type GoalInput } from '../schemas'
import { Detail, DetailList, EditSheet, NotSet } from './profile-ui'

interface GoalsSectionProps {
  plan: UseQueryResult<PlanData>
  details: ProfileDetails
  mutations: ReturnType<typeof useProfileMutations>
}

/**
 * Goals and workout capacity (spec §16, §22). Both are recommendation inputs:
 * the current cycle keeps the goals and capacity it was created with, so edits
 * here apply to the NEXT recommendation and never rewrite the current one.
 */
export function GoalsSection({ plan, details, mutations }: GoalsSectionProps) {
  const [sheet, setSheet] = useState<'goal' | 'capacity' | null>(null)
  const goal = plan.data?.activeGoal ?? null
  const current = plan.data?.recommendation ?? null

  return (
    <Section
      title="Goals & training"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSheet('goal')
          }}
        >
          <Pencil aria-hidden="true" />
          Edit goals
        </Button>
      }
    >
      {plan.isError ? (
        <SectionError title="Goals unavailable" onRetry={() => void plan.refetch()} />
      ) : plan.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <DetailList>
            <Detail label="Long-term goal">
              {goal ? longTermGoalLabel(goal.longTermGoal) : <NotSet />}
            </Detail>
            <Detail label="Short-term focus">
              {goal && goal.focuses.length > 0 ? (
                goal.focuses.map(focusLabel).join(', ')
              ) : (
                <NotSet />
              )}
            </Detail>
            <Detail label="Objective">
              {goal?.description ? (
                <span className="whitespace-pre-line">{goal.description}</span>
              ) : (
                <NotSet />
              )}
            </Detail>
            <Detail label="Workout capacity">
              {details.workoutDaysPerWeek === null ? (
                <NotSet />
              ) : (
                `${String(details.workoutDaysPerWeek)} days / week`
              )}
              <Button
                variant="link"
                className="ml-3"
                onClick={() => {
                  setSheet('capacity')
                }}
              >
                Edit
              </Button>
            </Detail>
          </DetailList>
          {current && (
            <p className="text-xs text-muted-foreground">
              Your current plan (from {formatShortDate(current.periodStart)}) keeps its goals and{' '}
              {current.capacity} workout days / week. Changes here apply to your next
              recommendation.
            </p>
          )}
        </>
      )}

      <EditSheet
        open={sheet === 'goal'}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        eyebrow="Goals"
        title="Edit goals"
        description="Used for your next recommendation."
      >
        <GoalForm
          goal={goal}
          onSave={async (input) => {
            try {
              await mutations.goal.mutateAsync(input)
            } catch (error) {
              throw new Error(
                friendlyProfileError(error, 'Couldn’t save your goals. Please try again.'),
                {
                  cause: error,
                },
              )
            }
            setSheet(null)
            notify.success(
              'Goals saved',
              current ? 'They apply to your next recommendation.' : undefined,
            )
          }}
        />
      </EditSheet>

      <EditSheet
        open={sheet === 'capacity'}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        eyebrow="Training"
        title="Workout capacity"
        description="How many days a week you can realistically work out. Used for your next recommendation."
      >
        <CapacityForm
          initial={details.workoutDaysPerWeek}
          currentCycle={current?.capacity ?? null}
          onSave={async (days) => {
            try {
              await mutations.capacity.mutateAsync(days)
            } catch (error) {
              throw new Error(
                friendlyProfileError(error, 'Couldn’t save your capacity. Please try again.'),
                { cause: error },
              )
            }
            setSheet(null)
            notify.success('Workout capacity saved', 'It applies to your next recommendation.')
          }}
        />
      </EditSheet>
    </Section>
  )
}

function ChoiceChip({
  selected,
  onClick,
  children,
  disabled,
}: {
  selected: boolean
  onClick: () => void
  children: string
  disabled: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-9 cursor-pointer rounded-xs border px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45',
        selected
          ? 'border-primary/60 bg-primary-surface text-foreground'
          : 'border-border text-foreground-secondary hover:border-foreground-secondary/40',
      )}
    >
      {children}
    </button>
  )
}

function GoalForm({
  goal,
  onSave,
}: {
  goal: GoalDetails | null
  onSave: (input: GoalInput) => Promise<void>
}) {
  const [longTermGoal, setLongTermGoal] = useState(goal?.longTermGoal ?? '')
  const [focuses, setFocuses] = useState<string[]>(goal?.focuses ?? [])
  const [objective, setObjective] = useState(goal?.description ?? '')
  const [errors, setErrors] = useState<
    Partial<Record<'longTermGoal' | 'focuses' | 'objective', string>>
  >({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = goalSchema.safeParse({ longTermGoal, focuses, objective })
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors({
        longTermGoal: fieldErrors.longTermGoal?.[0],
        focuses: fieldErrors.focuses?.[0],
        objective: fieldErrors.objective?.[0],
      })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await onSave(parsed.data)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2.5" disabled={saving}>
        <legend className="mb-2 label-section text-foreground-secondary">Long-term goal</legend>
        <div className="grid grid-cols-2 gap-2">
          {LONG_TERM_GOALS.map((value) => (
            <ChoiceChip
              key={value}
              selected={longTermGoal === value}
              disabled={saving}
              onClick={() => {
                setLongTermGoal(value)
              }}
            >
              {longTermGoalLabel(value)}
            </ChoiceChip>
          ))}
        </div>
        {errors.longTermGoal && <p className="text-sm text-destructive">{errors.longTermGoal}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2.5" disabled={saving}>
        <legend className="mb-2 label-section text-foreground-secondary">
          Short-term focus <span className="text-muted-foreground normal-case">(any number)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {FOCUS_TYPES.map((value) => {
            const selected = focuses.includes(value)
            return (
              <ChoiceChip
                key={value}
                selected={selected}
                disabled={saving}
                onClick={() => {
                  setFocuses((current) =>
                    selected ? current.filter((focus) => focus !== value) : [...current, value],
                  )
                }}
              >
                {focusLabel(value)}
              </ChoiceChip>
            )
          })}
        </div>
        {errors.focuses && <p className="text-sm text-destructive">{errors.focuses}</p>}
      </fieldset>

      <FormField
        id="objective"
        label="Objective (optional)"
        error={errors.objective}
        hint={`In your own words. ${String(objective.length)} / ${String(OBJECTIVE_MAX)}`}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            maxLength={OBJECTIVE_MAX}
            value={objective}
            onChange={(event) => {
              setObjective(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>

      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save goals'}
      </Button>
    </form>
  )
}

const CAPACITY_OPTIONS = [2, 3, 4, 5, 6].map((days) => ({
  value: String(days),
  label: String(days),
}))

function CapacityForm({
  initial,
  currentCycle,
  onSave,
}: {
  initial: number | null
  currentCycle: number | null
  onSave: (days: number) => Promise<void>
}) {
  const [days, setDays] = useState(String(initial ?? 4))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(Number(days))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="label-section text-foreground-secondary">Days per week</span>
        <SegmentedControl
          label="Days per week"
          value={days}
          onValueChange={setDays}
          options={CAPACITY_OPTIONS}
        />
      </div>
      {currentCycle !== null && (
        <InlineAlert tone="info" title="Current plan unchanged">
          Your current recommendation keeps {currentCycle} days / week until it ends.
        </InlineAlert>
      )}
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
