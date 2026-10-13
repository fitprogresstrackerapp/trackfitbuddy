import { ArrowDown, ArrowUp, Dumbbell, Flame, Footprints, Target, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { SectionError } from '@/components/common/section-error'
import { Section } from '@/components/layout/page'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPercent, formatWeekLabel } from '@/features/progress/lib/progress-format'
import type { Period } from '@/features/progress/types'
import { formatDayLabel } from '@/lib/dates/local-date'
import { formatNumber, NO_VALUE } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { useGroupWeek } from '../api/groups-queries'
import {
  formatStepsPerDay,
  formatWorkouts,
  neutralOrder,
  participation,
  weekChange,
  type MemberWeek,
  type WeekChange,
} from '../lib/group-week'

/*
 * The weekly view of a group (docs/groups.md). Shared accountability only:
 * the same values for every member, you first and then by name. No rank,
 * score, ordering by results or comparison between members (spec §47).
 */

type WeekQuery = ReturnType<typeof useGroupWeek>

function workoutNote(member: MemberWeek, week: Period, today: string): string | null {
  if (member.workouts.status === 'partial') return 'New plan this week'
  if (week.end >= today) return 'Week in progress'
  return null
}

function MetricLine({
  icon: Icon,
  label,
  value,
  change,
}: {
  icon: LucideIcon
  label: string
  value: string
  change?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="flex items-center gap-2 text-foreground-secondary">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {label}
      </dt>
      <dd className="flex items-baseline gap-2 text-right text-foreground tabular-nums">
        {value === NO_VALUE ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {NO_VALUE}
            </span>
            <span className="sr-only">Not enough data</span>
          </>
        ) : (
          value
        )}
        {change}
      </dd>
    </div>
  )
}

/** "↑ 8 pts" — your own change since last week. Neutral colours: it is not a verdict. */
function Change({
  value,
  unit,
  digits = 0,
}: {
  value: number | null
  /** Appended as is, e.g. " pts", "k/day". */
  unit: string
  digits?: number
}) {
  if (value === null) return null
  if (value === 0) {
    return <span className="label-mono text-muted-foreground">No change</span>
  }
  const Arrow = value > 0 ? ArrowUp : ArrowDown
  return (
    <span className="flex items-center gap-0.5 label-mono text-muted-foreground">
      <Arrow aria-hidden="true" className="size-3" />
      <span className="sr-only">{value > 0 ? 'Up' : 'Down'}</span>
      {formatNumber(Math.abs(value), digits)}
      {unit}
    </span>
  )
}

function stepsChange(value: number | null): number | null {
  return value === null ? null : Math.round(value / 100) / 10
}

/**
 * Your week (your own data): the four weekly values and, where both weeks
 * have one, the change since last week. Never a position in the group.
 */
export function YourWeek({
  userId,
  current,
  previous,
  week,
  today,
}: {
  userId: string
  current: WeekQuery
  previous: WeekQuery
  week: Period
  today: string
}) {
  if (current.isError) {
    return <SectionError title="Your week is unavailable" onRetry={() => void current.refetch()} />
  }
  const mine = current.data?.find((member) => member.userId === userId) ?? null
  const before = previous.data?.find((member) => member.userId === userId) ?? null
  const change: WeekChange = weekChange(mine, before)
  const steps = stepsChange(change.steps)
  const nothingYet =
    mine !== null &&
    mine.loggedDays.nutrition === 0 &&
    mine.loggedDays.workout === 0 &&
    mine.loggedDays.steps === 0

  return (
    <Section title="Your week" meta={formatWeekLabel(week.start, week.end)}>
      {current.isPending ? (
        <Skeleton className="h-36 w-full" />
      ) : !mine ? (
        <p className="text-sm text-muted-foreground">
          Your weekly progress appears here from the day you joined this group.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <dl className="grid divide-y divide-border border-y border-border text-sm sm:grid-cols-2 sm:divide-y-0 sm:[&>div:nth-child(n+3)]:border-t sm:[&>div:nth-child(n+3)]:border-border sm:[&>div:nth-child(odd)]:pr-6">
            <MetricLine
              icon={Flame}
              label="Calories in range"
              value={formatPercent(mine.nutrition.rate)}
              change={<Change value={change.nutrition} unit=" pts" />}
            />
            <MetricLine
              icon={Target}
              label="Protein met"
              value={formatPercent(mine.protein.rate)}
              change={<Change value={change.protein} unit=" pts" />}
            />
            <MetricLine
              icon={Dumbbell}
              label="Workout days"
              value={formatWorkouts(mine.workouts)}
              change={
                <Change
                  value={change.workouts}
                  unit={Math.abs(change.workouts ?? 0) === 1 ? ' day' : ' days'}
                />
              }
            />
            <MetricLine
              icon={Footprints}
              label="Steps"
              value={formatStepsPerDay(mine.steps)}
              change={<Change value={steps} unit="k/day" digits={1} />}
            />
          </dl>
          <p className="text-xs text-muted-foreground">
            {nothingYet
              ? 'Keep tracking — your weekly progress will update as you go.'
              : `Arrows compare with last week where both weeks have data. ${
                  week.end >= today
                    ? 'This week counts completed days for calories and protein, and workouts so far.'
                    : ''
                }`}
          </p>
        </div>
      )}
    </Section>
  )
}

/** Participation counts: is the group active this week? Never who did better. */
function GroupActivity({ members }: { members: readonly MemberWeek[] }) {
  const counts = participation(members)
  const items = [
    { label: 'active', value: counts.active },
    { label: 'logged food', value: counts.nutrition },
    { label: 'logged a workout', value: counts.workout },
    { label: 'logged steps', value: counts.steps },
  ]
  return (
    <section aria-label="Group activity" className="flex flex-col gap-2">
      <h3 className="label-section text-foreground-secondary">Group activity</h3>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.label} className="rounded-md border border-border px-3 py-2.5">
            <span className="metric text-lg text-foreground">
              {item.value} / {counts.members}
            </span>
            <span className="block text-xs text-foreground-secondary">members {item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Every member's week, you first and then by name. Desktop: a table; mobile:
 * one compact card per member. Values only; no colours of success or failure.
 */
export function GroupWeekMembers({
  query,
  userId,
  week,
  today,
  memberCount,
  invite,
}: {
  query: WeekQuery
  userId: string
  week: Period
  today: string
  memberCount: number
  invite: ReactNode
}) {
  if (query.isError) {
    return <SectionError title="Weekly progress unavailable" onRetry={() => void query.refetch()} />
  }
  if (query.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (memberCount <= 1) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-dashed border-border px-5 py-6">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          <p className="label-section text-foreground">You’re the first one here.</p>
        </div>
        <p className="text-sm text-foreground-secondary">
          Invite friends to start tracking together.
        </p>
        {invite}
      </div>
    )
  }
  const members = neutralOrder(query.data, userId)
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No shared data for this week. A member’s data appears from the day they joined.
      </p>
    )
  }
  const fromLabel = (member: MemberWeek) =>
    member.firstDay > week.start ? `From ${formatDayLabel(member.firstDay)}` : null

  return (
    <div className="flex flex-col gap-5">
      <GroupActivity members={members} />

      <div className="hidden lg:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Weekly progress of each member: you first, then by name.
          </caption>
          <thead>
            <tr className="label-mono text-muted-foreground">
              <th scope="col" className="pb-2 text-left font-normal">
                Member
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-normal">
                Calories in range
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-normal">
                Protein met
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-normal">
                Workout days
              </th>
              <th scope="col" className="pb-2 pl-3 text-right font-normal">
                Steps
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border border-t border-border">
            {members.map((member) => {
              const isMe = member.userId === userId
              const note = workoutNote(member, week, today)
              return (
                <tr key={member.userId} className={cn(isMe && 'bg-surface-1')}>
                  <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                    <span className="font-medium text-foreground">
                      {isMe ? 'You' : (member.name ?? 'Member')}
                    </span>
                    {fromLabel(member) && (
                      <span className="ml-2 label-mono text-muted-foreground">
                        {fromLabel(member)}
                      </span>
                    )}
                  </th>
                  <Cell value={formatPercent(member.nutrition.rate)} />
                  <Cell value={formatPercent(member.protein.rate)} />
                  <Cell value={formatWorkouts(member.workouts)} note={note} />
                  <Cell value={formatStepsPerDay(member.steps)} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {members.map((member) => {
          const isMe = member.userId === userId
          const note = workoutNote(member, week, today)
          return (
            <li key={member.userId} className="min-w-0">
              <article
                aria-label={isMe ? 'You' : (member.name ?? 'Member')}
                className={cn(
                  'flex h-full flex-col gap-2 rounded-md border bg-surface-1 px-4 py-3',
                  isMe ? 'border-primary/40' : 'border-border',
                )}
              >
                <header className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 className="min-w-0 truncate font-medium text-foreground">
                    {isMe ? 'You' : (member.name ?? 'Member')}
                  </h3>
                  {fromLabel(member) && (
                    <span className="label-mono text-muted-foreground">{fromLabel(member)}</span>
                  )}
                </header>
                <dl className="flex flex-col divide-y divide-border border-t border-border text-sm">
                  <MetricLine
                    icon={Flame}
                    label="Calories in range"
                    value={formatPercent(member.nutrition.rate)}
                  />
                  <MetricLine
                    icon={Target}
                    label="Protein met"
                    value={formatPercent(member.protein.rate)}
                  />
                  <MetricLine
                    icon={Dumbbell}
                    label="Workout days"
                    value={formatWorkouts(member.workouts)}
                    {...(note
                      ? { change: <span className="label-mono text-muted-foreground">{note}</span> }
                      : {})}
                  />
                  <MetricLine
                    icon={Footprints}
                    label="Steps"
                    value={formatStepsPerDay(member.steps)}
                  />
                </dl>
              </article>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        Calories in range and protein met count completed days with logged food and a target, as in
        Progress. Workout days count distinct days with a workout against each member’s weekly
        capacity. Steps are the average of days with an entry. A member counts from the day they
        joined. Members are listed you first, then by name.
      </p>
    </div>
  )
}

function Cell({ value, note }: { value: string; note?: string | null }) {
  return (
    <td className="py-2.5 pl-3 text-right text-foreground tabular-nums">
      {value === NO_VALUE ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            {NO_VALUE}
          </span>
          <span className="sr-only">Not enough data</span>
        </>
      ) : (
        value
      )}
      {note && <span className="block label-mono text-muted-foreground">{note}</span>}
    </td>
  )
}
