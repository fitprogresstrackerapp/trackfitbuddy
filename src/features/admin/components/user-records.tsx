import { Lock, Pencil, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { activityLabel } from '@/features/activity/lib/activity-types'
import { categoryLabel } from '@/features/food/lib/food-logic'
import { workoutLabel } from '@/features/workout/lib/workout-types'
import { formatShortDate } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'
import { notify } from '@/lib/feedback'

import type {
  CycleRecord,
  DeletableDomain,
  InbodyRecord,
  MealItemRecord,
  MealRecord,
  StepsRecord,
  TrainingRecord,
  WeightRecord,
} from '../api/admin-data'
import {
  useAdminMutations,
  useBodyRecords,
  useDayRecords,
  useRecommendationCycles,
} from '../api/admin-queries'
import { ConfirmDialog } from './admin-ui'
import {
  InbodyCorrection,
  MealCorrection,
  MealItemCorrection,
  StepsCorrection,
  TrainingCorrection,
  WeightCorrection,
} from './corrections'

type Editing =
  | { kind: 'meal'; record: MealRecord }
  | { kind: 'item'; record: MealItemRecord }
  | { kind: 'training'; record: TrainingRecord }
  | { kind: 'steps'; record: StepsRecord }
  | { kind: 'weight'; record: WeightRecord }
  | { kind: 'inbody'; record: InbodyRecord }
  | null

type Deleting = { domain: DeletableDomain; id: string; version: string; label: string } | null

/** One record line with its admin actions (only when this admin may administer the user). */
function RecordRow({
  title,
  detail,
  locked,
  canAdminister,
  onCorrect,
  onDelete,
  correctLabel,
}: {
  title: ReactNode
  detail?: ReactNode
  locked?: boolean
  canAdminister: boolean
  onCorrect?: () => void
  onDelete?: () => void
  correctLabel: string
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <div className="min-w-48 flex-1 basis-full sm:basis-0">
        <p className="text-sm break-words text-foreground">{title}</p>
        {detail && <p className="label-mono text-muted-foreground">{detail}</p>}
      </div>
      {locked && (
        <span className="flex items-center gap-1 label-mono text-muted-foreground">
          <Lock aria-hidden="true" className="size-3" />
          Locked
        </span>
      )}
      {canAdminister && onCorrect && (
        <Button variant="secondary" size="sm" aria-label={correctLabel} onClick={onCorrect}>
          <Pencil aria-hidden="true" />
          Admin correction
        </Button>
      )}
      {canAdminister && onDelete && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete: ${correctLabel.replace(/^Correct /, '')}`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
      )}
    </li>
  )
}

function Editors({
  editing,
  setEditing,
  deleting,
  setDeleting,
  userId,
}: {
  editing: Editing
  setEditing: (value: Editing) => void
  deleting: Deleting
  setDeleting: (value: Deleting) => void
  userId: string
}) {
  const { remove } = useAdminMutations(userId)
  const props = {
    open: true,
    userId,
    onOpenChange: (open: boolean) => {
      if (!open) setEditing(null)
    },
  }
  return (
    <>
      {editing?.kind === 'meal' && <MealCorrection {...props} meal={editing.record} />}
      {editing?.kind === 'item' && <MealItemCorrection {...props} item={editing.record} />}
      {editing?.kind === 'training' && <TrainingCorrection {...props} record={editing.record} />}
      {editing?.kind === 'steps' && <StepsCorrection {...props} entry={editing.record} />}
      {editing?.kind === 'weight' && <WeightCorrection {...props} record={editing.record} />}
      {editing?.kind === 'inbody' && <InbodyCorrection {...props} report={editing.record} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        eyebrow="Admin correction"
        title={`Delete ${deleting?.label ?? 'record'}?`}
        description="The record is kept, marked deleted and excluded from analytics. This is recorded in the audit log."
        confirmLabel="Delete record"
        onConfirm={async (reason) => {
          if (!deleting) return
          await remove.mutateAsync({ ...deleting, reason })
          notify.success('Record deleted', 'Recorded in the audit log.')
        }}
      />
    </>
  )
}

/** A day's nutrition and training records, with admin corrections. */
export function DayRecordsSections({
  userId,
  date,
  canAdminister,
}: {
  userId: string
  date: string
  canAdminister: boolean
}) {
  const day = useDayRecords(userId, date, true)
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<Deleting>(null)

  if (day.isError)
    return <SectionError title="Records unavailable" onRetry={() => void day.refetch()} />
  if (day.isPending) return <Skeleton className="h-48 w-full" />
  const { meals, workouts, activities, steps, totals, target } = day.data
  const training = [...workouts, ...activities]

  return (
    <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
      <Section
        title="Nutrition"
        meta={
          totals
            ? `${formatNumber(totals.calories)}${target ? ` / ${formatNumber(target.calories)}` : ''} kcal`
            : target
              ? `Target ${formatNumber(target.calories)} kcal`
              : undefined
        }
      >
        {meals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meals logged.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {meals.map((meal) => (
              <li key={meal.id} className="flex flex-col gap-1">
                <ul className="divide-y divide-border border-y border-border">
                  <RecordRow
                    title={<span className="font-medium">{categoryLabel(meal.category)}</span>}
                    detail={`${String(meal.items.length)} ${meal.items.length === 1 ? 'item' : 'items'}`}
                    locked={meal.isLocked}
                    canAdminister={canAdminister}
                    correctLabel={`Correct meal ${categoryLabel(meal.category)}`}
                    onCorrect={() => {
                      setEditing({ kind: 'meal', record: meal })
                    }}
                    onDelete={() => {
                      setDeleting({
                        domain: 'meal',
                        id: meal.id,
                        version: meal.updatedAt,
                        label: `${categoryLabel(meal.category)} meal`,
                      })
                    }}
                  />
                  {meal.items.map((item) => (
                    <RecordRow
                      key={item.id}
                      title={item.name}
                      detail={`${formatNumber(item.quantity, 2)} ${item.unit} · ${formatNumber(item.calories)} kcal · ${formatNumber(item.proteinG, 1)} g protein`}
                      canAdminister={canAdminister}
                      correctLabel={`Correct ${item.name}`}
                      onCorrect={() => {
                        setEditing({ kind: 'item', record: item })
                      }}
                      onDelete={() => {
                        setDeleting({
                          domain: 'meal_item',
                          id: item.id,
                          version: item.updatedAt,
                          label: item.name,
                        })
                      }}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {target && (
          <p className="text-xs text-muted-foreground">
            Target {formatNumber(target.calories)} kcal · {formatNumber(target.proteinG)} g protein
            ({target.source === 'snapshot' ? 'that day’s snapshot' : 'cycle target'}). Corrections
            never change targets.
          </p>
        )}
      </Section>

      <Section title="Training & steps">
        {training.length === 0 && steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workouts, activities or steps logged.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {training.map((record) => {
              const label =
                record.kind === 'workout'
                  ? workoutLabel(record.type, record.name)
                  : activityLabel(record.type, record.name)
              return (
                <RecordRow
                  key={record.id}
                  title={`${record.kind === 'workout' ? 'Workout' : 'Activity'} · ${label}`}
                  detail={`${String(record.durationMinutes)} min · ${formatNumber(record.finalCalories)} kcal${record.manualCalories === null ? ' (estimated)' : ''}`}
                  locked={record.isLocked}
                  canAdminister={canAdminister}
                  correctLabel={`Correct ${record.kind} ${label}`}
                  onCorrect={() => {
                    setEditing({ kind: 'training', record })
                  }}
                  onDelete={() => {
                    setDeleting({
                      domain: record.kind,
                      id: record.id,
                      version: record.updatedAt,
                      label,
                    })
                  }}
                />
              )
            })}
            {steps.map((entry) => (
              <RecordRow
                key={entry.id}
                title={`Steps · ${formatNumber(entry.steps)}`}
                detail={entry.isActive ? 'Active value of the day' : 'Earlier entry'}
                canAdminister={canAdminister}
                correctLabel={`Correct steps ${formatNumber(entry.steps)}`}
                onCorrect={() => {
                  setEditing({ kind: 'steps', record: entry })
                }}
                onDelete={() => {
                  setDeleting({
                    domain: 'steps',
                    id: entry.id,
                    version: entry.updatedAt,
                    label: 'step entry',
                  })
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      <Editors
        editing={editing}
        setEditing={setEditing}
        deleting={deleting}
        setDeleting={setDeleting}
        userId={userId}
      />
    </div>
  )
}

/** Weight history and InBody reports. */
export function BodySection({ userId, canAdminister }: { userId: string; canAdminister: boolean }) {
  const body = useBodyRecords(userId, true)
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<Deleting>(null)
  return (
    <Section title="Body">
      {body.isError ? (
        <SectionError title="Body records unavailable" onRetry={() => void body.refetch()} />
      ) : body.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="flex flex-col gap-2">
            <h3 className="label-section text-foreground-secondary">Weight history</h3>
            {body.data.weights.length === 0 ? (
              <p className="text-sm text-muted-foreground">No weight recorded.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {body.data.weights.map((weight) => (
                  <RecordRow
                    key={weight.id}
                    title={`${formatNumber(weight.weightKg, 2)} kg`}
                    detail={`${formatShortDate(weight.date)} · ${weight.source === 'INBODY' ? 'InBody' : 'Manual'}`}
                    canAdminister={canAdminister && weight.source === 'MANUAL'}
                    correctLabel={`Correct weight ${formatShortDate(weight.date)}`}
                    onCorrect={() => {
                      setEditing({ kind: 'weight', record: weight })
                    }}
                    onDelete={() => {
                      setDeleting({
                        domain: 'weight',
                        id: weight.id,
                        version: weight.updatedAt,
                        label: 'weight entry',
                      })
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="label-section text-foreground-secondary">InBody</h3>
            {body.data.inbody.length === 0 ? (
              <p className="text-sm text-muted-foreground">No InBody reports.</p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {body.data.inbody.map((report) => (
                  <RecordRow
                    key={report.reportId}
                    title={formatShortDate(report.date)}
                    detail={
                      report.metrics
                        ? [
                            report.metrics.weightKg === null
                              ? null
                              : `${formatNumber(report.metrics.weightKg, 2)} kg`,
                            report.metrics.bodyFatPercent === null
                              ? null
                              : `${formatNumber(report.metrics.bodyFatPercent, 1)}% fat`,
                            report.metrics.muscleMassKg === null
                              ? null
                              : `${formatNumber(report.metrics.muscleMassKg, 2)} kg muscle`,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Metrics recorded'
                        : 'Awaiting results (no metrics to correct)'
                    }
                    canAdminister={canAdminister && report.metrics !== null}
                    correctLabel={`Correct InBody ${formatShortDate(report.date)}`}
                    onCorrect={() => {
                      setEditing({ kind: 'inbody', record: report })
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <Editors
        editing={editing}
        setEditing={setEditing}
        deleting={deleting}
        setDeleting={setDeleting}
        userId={userId}
      />
    </Section>
  )
}

const CYCLE_BADGES: Record<
  CycleRecord['status'],
  { status: 'pending' | 'locked' | 'warning'; label: string }
> = {
  IN_REVIEW: { status: 'pending', label: 'In review' },
  LOCKED: { status: 'locked', label: 'Locked' },
  REPLACED: { status: 'warning', label: 'Replaced' },
}

/** Recommendation history (read-only; reprocessing lives in Recommendations). */
export function RecommendationsSection({ userId }: { userId: string }) {
  const cycles = useRecommendationCycles(userId, true)
  return (
    <Section title="Recommendations">
      {cycles.isError ? (
        <SectionError title="Recommendations unavailable" onRetry={() => void cycles.refetch()} />
      ) : cycles.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : cycles.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recommendation generated yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {cycles.data.map((cycle) => (
            <li
              key={cycle.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1 basis-full text-foreground sm:basis-0">
                {formatShortDate(cycle.periodStart)} –{' '}
                {cycle.periodEnd ? formatShortDate(cycle.periodEnd) : 'ongoing'}
                <span className="ml-2 label-mono text-muted-foreground">
                  {formatNumber(cycle.finalCalories)} kcal · {formatNumber(cycle.finalProteinG)} g
                  protein · {cycle.workoutDaysPerWeek} days/week
                </span>
              </span>
              <span className="label-mono text-muted-foreground">
                {cycle.model} · {cycle.promptVersion}
              </span>
              <StatusBadge {...CYCLE_BADGES[cycle.status]} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Recommendations are generated and reprocessed from Recommendations; they are not edited
        here.
      </p>
    </Section>
  )
}
