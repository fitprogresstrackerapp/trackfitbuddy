import type { UseQueryResult } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'
import { Link } from 'react-router'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Button, IconButton } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { addDays, formatDayLabel, formatShortDate } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'
import { formatNumber } from '@/lib/format'

import type { InbodyReport, ProfileDetails, WeightData, WeightEntry } from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { friendlyProfileError, isEditableDay } from '../lib/profile-logic'
import { createWeightEntrySchema, ENTRY_WINDOW_DAYS, heightSchema } from '../schemas'
import { Detail, DetailList, EditSheet, NotSet } from './profile-ui'

const SOURCE_LABEL = { MANUAL: 'Manual', INBODY: 'InBody' } as const

interface BodySectionProps {
  details: ProfileDetails
  weights: UseQueryResult<WeightData>
  inbody: UseQueryResult<InbodyReport[]>
  today: string
  mutations: ReturnType<typeof useProfileMutations>
}

/**
 * Body (spec §20–21): the current weight is the latest valid measurement —
 * measurements are history, never a single overwritten value. InBody wins over
 * a manual entry on the same date; both stay in the history. Progress remains
 * the place for trends.
 */
export function BodySection({ details, weights, inbody, today, mutations }: BodySectionProps) {
  const [sheet, setSheet] = useState<'weight' | 'height' | null>(null)
  const [editing, setEditing] = useState<WeightEntry | null>(null)
  const [deleting, setDeleting] = useState<WeightEntry | null>(null)
  const latestInbody = inbody.data?.find((report) => report.metrics !== null) ?? null
  const current = weights.data?.current ?? null
  const recent = weights.data?.recent ?? []

  return (
    <Section
      title="Body"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSheet('weight')
          }}
        >
          <Plus aria-hidden="true" />
          Update weight
        </Button>
      }
    >
      <DetailList>
        <Detail label="Current weight">
          {weights.isPending ? (
            <Skeleton className="ml-auto h-4 w-24" />
          ) : current ? (
            <>
              <span className="metric text-lg">{formatNumber(current.weightKg, 2)}</span> kg
              <span className="ml-2 label-mono text-muted-foreground">
                {SOURCE_LABEL[current.source]} · {formatShortDate(current.date)}
              </span>
            </>
          ) : (
            <NotSet>—</NotSet>
          )}
        </Detail>
        <Detail label="Height">
          {details.heightCm === null ? <NotSet /> : `${formatNumber(details.heightCm, 1)} cm`}
          <Button
            variant="link"
            className="ml-3"
            onClick={() => {
              setSheet('height')
            }}
          >
            Edit
          </Button>
        </Detail>
        <Detail label="Latest InBody">
          {latestInbody ? formatDayLabel(latestInbody.date) : <NotSet>—</NotSet>}
        </Detail>
        {latestInbody?.metrics?.bodyFatPercent != null && (
          <Detail label="Body fat">{formatNumber(latestInbody.metrics.bodyFatPercent, 1)}%</Detail>
        )}
        {latestInbody?.metrics?.muscleMassKg != null && (
          <Detail label="Muscle mass">
            {formatNumber(latestInbody.metrics.muscleMassKg, 1)} kg
          </Detail>
        )}
      </DetailList>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="label-section text-foreground-secondary">Weight history</h3>
          <Link
            to={`${ROUTES.progress}?range=3M`}
            className="label-mono text-primary hover:underline"
          >
            Trend in Progress
          </Link>
        </div>
        {weights.isError ? (
          <SectionError title="Weights unavailable" onRetry={() => void weights.refetch()} />
        ) : weights.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No weight measurements yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {recent.map((entry) => {
              const editable = entry.source === 'MANUAL' && isEditableDay(entry.date, today)
              const isCurrent = entry.id === current?.id
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5"
                >
                  <span className="w-16 shrink-0 label-mono text-muted-foreground">
                    {formatShortDate(entry.date)}
                  </span>
                  <span className="text-sm whitespace-nowrap text-foreground tabular-nums">
                    {formatNumber(entry.weightKg, 2)} kg
                  </span>
                  <span className="label-mono text-muted-foreground">
                    {SOURCE_LABEL[entry.source]}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    {isCurrent && <StatusBadge status="active" label="Current" />}
                    {!editable && entry.date < today && (
                      <Lock aria-label="Locked" className="size-3.5 text-muted-foreground" />
                    )}
                    {editable && (
                      <>
                        <IconButton
                          label={`Edit ${formatNumber(entry.weightKg, 2)} kg`}
                          icon={Pencil}
                          size="sm"
                          onClick={() => {
                            setEditing(entry)
                          }}
                        />
                        <IconButton
                          label={`Delete ${formatNumber(entry.weightKg, 2)} kg`}
                          icon={Trash2}
                          size="sm"
                          // The only measurement is the required current weight.
                          disabled={recent.length <= 1}
                          onClick={() => {
                            setDeleting(entry)
                          }}
                        />
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <EditSheet
        open={sheet === 'weight'}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        eyebrow="Body"
        title="Update weight"
        description="Adds a new measurement; earlier ones stay in your history."
      >
        <WeightForm
          today={today}
          onSave={async (input) => {
            await run(
              () => mutations.addWeight.mutateAsync(input),
              'Couldn’t save the weight. Please try again.',
            )
            setSheet(null)
            notify.success(
              'Weight saved',
              `${formatNumber(input.weightKg, 2)} kg · ${formatShortDate(input.date)}`,
            )
          }}
        />
      </EditSheet>

      <EditSheet
        open={sheet === 'height'}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        eyebrow="Body"
        title="Edit height"
      >
        <HeightForm
          initial={details.heightCm}
          onSave={async (heightCm) => {
            await run(
              () => mutations.height.mutateAsync(heightCm),
              'Couldn’t save the height. Please try again.',
            )
            setSheet(null)
            notify.success('Height saved')
          }}
        />
      </EditSheet>

      <EditSheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        eyebrow="Today"
        title="Correct today’s weight"
      >
        {editing && (
          <WeightForm
            today={today}
            initial={editing}
            onSave={async (input) => {
              await run(
                () =>
                  mutations.editWeight.mutateAsync({ id: editing.id, weightKg: input.weightKg }),
                'Couldn’t update the weight. Please try again.',
              )
              setEditing(null)
              notify.success('Weight updated')
            }}
          />
        )}
      </EditSheet>

      <EditSheet
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        eyebrow="Today"
        title="Delete this measurement?"
        description={
          deleting
            ? `${formatNumber(deleting.weightKg, 2)} kg on ${formatShortDate(deleting.date)}`
            : undefined
        }
      >
        {deleting && (
          <ConfirmDelete
            onConfirm={async () => {
              await run(
                () => mutations.removeWeight.mutateAsync(deleting.id),
                'Couldn’t delete the measurement. Please try again.',
              )
              setDeleting(null)
              notify.success('Measurement deleted')
            }}
          />
        )}
      </EditSheet>
    </Section>
  )
}

async function run(action: () => Promise<unknown>, fallback: string) {
  try {
    await action()
  } catch (error) {
    throw new Error(friendlyProfileError(error, fallback), { cause: error })
  }
}

export function ConfirmDelete({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-4">
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button
        variant="destructive"
        size="lg"
        disabled={working}
        onClick={() => {
          setWorking(true)
          setError(null)
          onConfirm().catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : String(caught))
            setWorking(false)
          })
        }}
      >
        {working ? 'Deleting…' : 'Delete'}
      </Button>
    </div>
  )
}

function WeightForm({
  today,
  initial,
  onSave,
}: {
  today: string
  initial?: WeightEntry
  onSave: (input: { weightKg: number; date: string }) => Promise<void>
}) {
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : '')
  const [date, setDate] = useState(initial?.date ?? today)
  const [errors, setErrors] = useState<Partial<Record<'weightKg' | 'date', string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = createWeightEntrySchema(today).safeParse({ weightKg: weight, date })
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors({ weightKg: fieldErrors.weightKg?.[0], date: fieldErrors.date?.[0] })
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
      <FormField id="weight-kg" label="Weight" error={errors.weightKg}>
        {(control) => (
          <AdornedInput
            {...control}
            trailing="KG"
            inputMode="decimal"
            autoComplete="off"
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      <FormField
        id="weight-date"
        label="Date"
        error={errors.date}
        hint={initial ? 'The date of a saved measurement can’t be changed.' : undefined}
      >
        {(control) => (
          <DatePicker
            {...control}
            value={date}
            max={today}
            min={addDays(today, -ENTRY_WINDOW_DAYS)}
            onChange={(event) => {
              setDate(event.target.value)
            }}
            disabled={saving || initial !== undefined}
          />
        )}
      </FormField>
      {date < today && !initial && (
        <InlineAlert tone="warning" icon={Lock} title="Locked once saved">
          A measurement for a past day can’t be changed after saving.
        </InlineAlert>
      )}
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

function HeightForm({
  initial,
  onSave,
}: {
  initial: number | null
  onSave: (heightCm: number) => Promise<void>
}) {
  const [height, setHeight] = useState(initial === null ? '' : String(initial))
  const [error, setError] = useState<string | undefined>()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = heightSchema.safeParse({ heightCm: height })
    if (!parsed.success) {
      setError(z.flattenError(parsed.error).fieldErrors.heightCm?.[0])
      return
    }
    setError(undefined)
    setSaving(true)
    try {
      await onSave(parsed.data.heightCm)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <FormField id="height-cm" label="Height" error={error}>
        {(control) => (
          <AdornedInput
            {...control}
            trailing="CM"
            inputMode="decimal"
            autoComplete="off"
            value={height}
            onChange={(event) => {
              setHeight(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
