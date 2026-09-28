import type { UseQueryResult } from '@tanstack/react-query'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { Button, IconButton } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { addDays, formatDayLabel } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'
import { formatNumber, NO_VALUE } from '@/lib/format'

import type { StepEntry } from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { friendlyProfileError, isEditableDay, stepsByDay } from '../lib/profile-logic'
import { createStepsEntrySchema, ENTRY_WINDOW_DAYS } from '../schemas'
import { ConfirmDelete } from './body-section'
import { EditSheet } from './profile-ui'

const RECENT_DAYS = 7

interface StepsSectionProps {
  steps: UseQueryResult<StepEntry[]>
  today: string
  mutations: ReturnType<typeof useProfileMutations>
}

/**
 * Steps (spec §19): manual daily entries. Several entries per day are kept;
 * the latest valid one is the day's value (never a sum). No step goal exists
 * in Phase 1, so none is shown. Steps are not activities or workouts.
 */
export function StepsSection({ steps, today, mutations }: StepsSectionProps) {
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState<StepEntry | null>(null)
  const days = useMemo(() => (steps.data ? stepsByDay(steps.data) : []), [steps.data])
  const todayDay = days.find((day) => day.date === today) ?? null
  const recent = Array.from({ length: RECENT_DAYS }, (_, index) => addDays(today, -index)).map(
    (date) => days.find((day) => day.date === date) ?? { date, active: null, entries: [] },
  )

  return (
    <Section
      title="Steps"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(true)
          }}
        >
          <Plus aria-hidden="true" />
          Update steps
        </Button>
      }
    >
      {steps.isError ? (
        <SectionError title="Steps unavailable" onRetry={() => void steps.refetch()} />
      ) : steps.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <ICONS.steps aria-hidden="true" className="size-4 self-center text-muted-foreground" />
            <span className="label-mono text-muted-foreground">Today</span>
            {todayDay?.active != null ? (
              <>
                <span className="metric text-3xl text-foreground">
                  {formatNumber(todayDay.active)}
                </span>
                <span className="label-mono text-muted-foreground">steps</span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">No entry today</span>
            )}
          </div>

          {todayDay && todayDay.entries.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="label-mono text-muted-foreground">
                Today’s entries · the latest is used
              </p>
              <ul className="divide-y divide-border rounded-md border border-border">
                {todayDay.entries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-sm text-foreground tabular-nums">
                      {formatNumber(entry.steps)}
                    </span>
                    <span className="label-mono text-muted-foreground">
                      {entry.isActive ? 'Active' : 'Earlier entry'}
                    </span>
                    {isEditableDay(entry.date, today) && (
                      <IconButton
                        label={`Delete entry of ${formatNumber(entry.steps)} steps`}
                        icon={Trash2}
                        size="sm"
                        className="ml-auto"
                        onClick={() => {
                          setDeleting(entry)
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <p className="label-mono text-muted-foreground">Recent days</p>
            <ul className="divide-y divide-border border-y border-border">
              {recent.map((day) => (
                <li key={day.date} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-28 shrink-0 label-mono text-muted-foreground">
                    {day.date === today ? 'Today' : formatDayLabel(day.date)}
                  </span>
                  <span className="text-foreground tabular-nums">
                    {day.active === null ? NO_VALUE : formatNumber(day.active)}
                  </span>
                  {day.entries.length > 1 && (
                    <span className="label-mono text-muted-foreground">
                      {day.entries.length} entries
                    </span>
                  )}
                  {day.date < today && day.entries.length > 0 && (
                    <Lock aria-label="Locked" className="ml-auto size-3.5 text-muted-foreground" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <EditSheet
        open={open}
        onOpenChange={setOpen}
        eyebrow="Steps"
        title="Update steps"
        description="Enter the day’s total. A newer entry replaces the day’s value; earlier entries stay in your history."
      >
        <StepsForm
          today={today}
          onSave={async (input) => {
            try {
              await mutations.addSteps.mutateAsync(input)
            } catch (error) {
              throw new Error(
                friendlyProfileError(error, 'Couldn’t save your steps. Please try again.'),
                {
                  cause: error,
                },
              )
            }
            setOpen(false)
            notify.success(
              'Steps saved',
              `${formatNumber(input.steps)} · ${formatDayLabel(input.date)}`,
            )
          }}
        />
      </EditSheet>

      <EditSheet
        open={deleting !== null}
        onOpenChange={(value) => {
          if (!value) setDeleting(null)
        }}
        eyebrow="Today"
        title="Delete this entry?"
        description="If it is the active entry, the previous entry becomes today’s value."
      >
        {deleting && (
          <ConfirmDelete
            onConfirm={async () => {
              try {
                await mutations.removeSteps.mutateAsync(deleting.id)
              } catch (error) {
                throw new Error(
                  friendlyProfileError(error, 'Couldn’t delete the entry. Please try again.'),
                  { cause: error },
                )
              }
              setDeleting(null)
              notify.success('Entry deleted')
            }}
          />
        )}
      </EditSheet>
    </Section>
  )
}

function StepsForm({
  today,
  onSave,
}: {
  today: string
  onSave: (input: { steps: number; date: string }) => Promise<void>
}) {
  const [steps, setSteps] = useState('')
  const [date, setDate] = useState(today)
  const [errors, setErrors] = useState<Partial<Record<'steps' | 'date', string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = createStepsEntrySchema(today).safeParse({ steps, date })
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors({ steps: fieldErrors.steps?.[0], date: fieldErrors.date?.[0] })
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
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <FormField id="steps-count" label="Steps" error={errors.steps}>
        {(control) => (
          <AdornedInput
            {...control}
            trailing="STEPS"
            inputMode="numeric"
            autoComplete="off"
            value={steps}
            onChange={(event) => {
              setSteps(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      <FormField id="steps-date" label="Date" error={errors.date}>
        {(control) => (
          <DatePicker
            {...control}
            value={date}
            max={today}
            min={addDays(today, -ENTRY_WINDOW_DAYS)}
            onChange={(event) => {
              setDate(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      {date < today && (
        <InlineAlert tone="warning" icon={Lock} title="Past days">
          Steps can be added for a past day without an entry; they are locked once saved.
        </InlineAlert>
      )}
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
