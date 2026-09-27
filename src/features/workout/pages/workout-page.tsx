import { ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { DayNav } from '@/components/common/day-nav'
import { ErrorState } from '@/components/common/error-state'
import { InlineAlert } from '@/components/common/inline-alert'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button, IconButton } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccount } from '@/features/auth/auth-context'
import {
  useTrainingMutations,
  useTrainingPlan,
  useTrainingWeek,
} from '@/features/training/api/training-queries'
import { DeleteRecordDialog } from '@/features/training/components/delete-dialog'
import { GuidanceBlock } from '@/features/training/components/guidance'
import { RecordList } from '@/features/training/components/record-list'
import {
  TrainingSheet,
  type TrainingSheetMode,
} from '@/features/training/components/training-sheet'
import {
  CapacityBlock,
  ExpenditureRow,
  WeekSummarySkeleton,
} from '@/features/training/components/week-summary'
import { KIND_NOUN, recordLabel } from '@/features/training/lib/labels'
import {
  countWorkoutDays,
  friendlyTrainingError,
  isTransitionWeek,
  workoutGuidance,
} from '@/features/training/lib/training'
import type { TrainingInput } from '@/features/training/schemas'
import type { TrainingKind, TrainingRecord } from '@/features/training/types'
import { dayKind, LATE_ENTRY_DAYS, resolveDateParam } from '@/lib/dates/day-param'
import {
  addDays,
  calendarWeekOf,
  formatDayLabel,
  formatShortDate,
  safeTimeZone,
  todayInTimeZone,
} from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'

const ADD_PARAMS: Record<string, TrainingKind> = { workout: 'workout', activity: 'activity' }

/**
 * Workout (spec §14–18): the Monday–Sunday week's workout days against the
 * recommendation's capacity, the template as guidance, and the week's
 * workouts and activities. "Today" is the profile-timezone day the database
 * uses for locking; past days only accept a missing entry (late entry).
 */
export function WorkoutPage() {
  const { profile } = useAccount()
  const timeZone = safeTimeZone(profile.timezone)
  const today = todayInTimeZone(timeZone)
  const [params, setParams] = useSearchParams()
  const { date, valid } = resolveDateParam(params.get('date'), today)
  const day = dayKind(date, today)
  const canAdd = day.kind === 'today' || (day.kind === 'past' && day.lateEntry)
  const week = calendarWeekOf(date)
  const isCurrentWeek = week.start === calendarWeekOf(today).start

  const weekQuery = useTrainingWeek(profile.id, week, today)
  const planQuery = useTrainingPlan(profile.id, date)
  const mutations = useTrainingMutations(profile.id)

  const [sheet, setSheet] = useState<TrainingSheetMode | null>(null)
  const [deleting, setDeleting] = useState<TrainingRecord | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())

  // ?add=workout|activity (Home quick actions) opens the form; closing clears it.
  const addKind = ADD_PARAMS[params.get('add') ?? '']
  const linkMode: TrainingSheetMode | null =
    addKind && canAdd ? { kind: addKind, action: 'create', date } : null
  const sheetMode = sheet ?? linkMode

  function closeSheet() {
    setSheet(null)
    if (params.has('add')) {
      setParams(
        (current) => {
          current.delete('add')
          return current
        },
        { replace: true },
      )
    }
  }

  function goTo(next: string) {
    setParams((current) => {
      if (next === today) current.delete('date')
      else current.set('date', next)
      current.delete('add')
      return current
    })
  }

  function markBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  async function submit(mode: TrainingSheetMode, values: TrainingInput) {
    const noun = KIND_NOUN[mode.kind]
    try {
      if (mode.action === 'create') {
        await mutations.create.mutateAsync({ kind: mode.kind, values })
      } else {
        await mutations.update.mutateAsync({ kind: mode.kind, id: mode.record.id, values })
      }
    } catch (error) {
      throw new Error(
        friendlyTrainingError(error, `Couldn’t save this ${noun}. Please try again.`),
        { cause: error },
      )
    }
    closeSheet()
    const label = recordLabel(mode.kind, values.type, values.name)
    notify.success(
      mode.action === 'edit' ? `${capitalize(noun)} updated` : `${capitalize(noun)} logged`,
      mode.action === 'edit'
        ? label
        : `${label} · ${values.date === today ? 'today' : formatDayLabel(values.date)}`,
    )
  }

  async function confirmDelete(record: TrainingRecord) {
    markBusy(record.id, true)
    try {
      await mutations.remove.mutateAsync({ kind: record.kind, id: record.id })
    } catch (error) {
      throw new Error(
        friendlyTrainingError(
          error,
          `Couldn’t delete this ${KIND_NOUN[record.kind]}. Please try again.`,
        ),
        { cause: error },
      )
    } finally {
      markBusy(record.id, false)
    }
    setDeleting(null)
    notify.success(
      `${capitalize(KIND_NOUN[record.kind])} deleted`,
      recordLabel(record.kind, record.type, record.name),
    )
  }

  const data = weekQuery.data
  const plan = planQuery.data ?? null
  const done = data
    ? countWorkoutDays(
        data.workouts.map((record) => record.date),
        today,
      )
    : 0
  const transition = isTransitionWeek(plan?.cycle ?? null, week)
  const guidance = workoutGuidance(plan, done)

  const logButton = (kind: TrainingKind, variant: 'primary' | 'secondary') => (
    <Button
      variant={variant}
      onClick={() => {
        setSheet({ kind, action: 'create', date })
      }}
    >
      <Plus aria-hidden="true" />
      Log {kind}
    </Button>
  )

  return (
    <Page>
      <PageHeader
        eyebrow={date === today ? `Today · ${formatDayLabel(date)}` : formatDayLabel(date)}
        title="Workout"
        actions={
          canAdd ? (
            <>
              {logButton('activity', 'secondary')}
              {logButton('workout', 'primary')}
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <DayNav date={date} today={today} onChange={goTo} />
        {!valid && (
          <InlineAlert tone="info" title="Showing today">
            That date isn’t available — workouts and activities can’t be logged for future dates.
          </InlineAlert>
        )}
        {day.kind === 'past' && (
          <InlineAlert tone="info" icon={Lock} title="Past day · locked">
            {day.lateEntry
              ? 'Existing entries can’t be changed. You can still add a workout or activity you missed; it locks once saved.'
              : `This day is read-only. Missing entries can be added for the last ${String(LATE_ENTRY_DAYS)} days.`}
          </InlineAlert>
        )}
      </div>

      <Section
        title={isCurrentWeek ? 'This week' : 'Week'}
        meta={`${formatShortDate(week.start)} – ${formatShortDate(week.end)}`}
        action={
          <div className="flex items-center gap-1">
            <IconButton
              label="Previous week"
              icon={ChevronLeft}
              size="sm"
              onClick={() => {
                goTo(addDays(date, -7))
              }}
            />
            <IconButton
              label="Next week"
              icon={ChevronRight}
              size="sm"
              disabled={isCurrentWeek}
              onClick={() => {
                const next = addDays(date, 7)
                goTo(next > today ? today : next)
              }}
            />
          </div>
        }
      >
        {weekQuery.isError ? (
          <ErrorState
            title="This week couldn’t be loaded"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => void weekQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6">
              {!data || planQuery.isPending ? (
                <WeekSummarySkeleton />
              ) : (
                <>
                  {planQuery.isError && (
                    <InlineAlert tone="warning" title="Workout capacity couldn’t be loaded">
                      <span className="flex flex-wrap items-center gap-3">
                        Your logged workouts are shown without it.
                        <Button variant="link" onClick={() => void planQuery.refetch()}>
                          Retry
                        </Button>
                      </span>
                    </InlineAlert>
                  )}
                  <CapacityBlock
                    done={done}
                    capacity={plan?.capacity ?? null}
                    transition={transition}
                    cycleStart={transition ? (plan?.cycle?.periodStart ?? null) : null}
                    isCurrentWeek={isCurrentWeek}
                  />
                  <ExpenditureRow week={data} />
                </>
              )}
            </div>
            <div>
              {planQuery.isPending || !data ? (
                <Skeleton className="h-40 w-full" />
              ) : planQuery.isError ? null : plan ? (
                <GuidanceBlock plan={plan} guidance={guidance} isCurrentWeek={isCurrentWeek} />
              ) : null}
            </div>
          </div>
        )}
      </Section>

      {!weekQuery.isError && (
        <div className="grid gap-10 lg:grid-cols-2">
          {(['workout', 'activity'] as const).map((kind) => {
            const records = kind === 'workout' ? data?.workouts : data?.activities
            return (
              <Section
                key={kind}
                title={kind === 'workout' ? 'Workouts' : 'Activities'}
                meta={
                  records
                    ? `${String(records.length)} ${kind === 'workout' ? (records.length === 1 ? 'workout' : 'workouts') : records.length === 1 ? 'activity' : 'activities'}`
                    : undefined
                }
              >
                {!records ? (
                  <div className="flex flex-col gap-3" aria-hidden="true">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : (
                  <RecordList
                    kind={kind}
                    records={records}
                    today={today}
                    busyIds={busyIds}
                    empty={
                      kind === 'workout'
                        ? {
                            title: 'No workouts yet',
                            description: isCurrentWeek
                              ? 'Log your first workout to start tracking weekly consistency.'
                              : 'No workouts were logged this week.',
                            ...(canAdd ? { action: logButton('workout', 'secondary') } : {}),
                          }
                        : {
                            title: 'No activities yet',
                            description:
                              'Add walking, cricket, cycling, or another activity. Activities are tracked separately from workouts.',
                            ...(canAdd ? { action: logButton('activity', 'secondary') } : {}),
                          }
                    }
                    onEdit={(record) => {
                      setSheet({ kind: record.kind, action: 'edit', record })
                    }}
                    onDelete={setDeleting}
                  />
                )}
              </Section>
            )
          })}
        </div>
      )}

      <TrainingSheet
        mode={sheetMode}
        today={today}
        onOpenChange={(open) => {
          if (!open) closeSheet()
        }}
        onSubmit={(values) => (sheetMode ? submit(sheetMode, values) : Promise.resolve())}
      />
      <DeleteRecordDialog
        record={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        onConfirm={() => (deleting ? confirmDelete(deleting) : Promise.resolve())}
      />
    </Page>
  )
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
