import { LogOut, Shield, UserMinus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { DayNav } from '@/components/common/day-nav'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { useAccount } from '@/features/auth/auth-context'
import { resolveDateParam } from '@/lib/dates/day-param'
import {
  formatDayLabel,
  formatShortDate,
  safeTimeZone,
  todayInTimeZone,
} from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'

import type { GroupMember, GroupRole, GroupSummary } from '../api/groups-data'
import { useGroupDay, useGroupMembers, useGroupMutations, useMyGroups } from '../api/groups-queries'
import { CopyCodeButton } from '../components/group-sheets'
import { MemberCard } from '../components/member-card'
import {
  formatGroupCode,
  friendlyGroupError,
  leaveOutcome,
  permissionsFor,
  ROLE_LABELS,
} from '../lib/groups-logic'

const ROLES: readonly GroupRole[] = ['MEMBER', 'LEADER', 'ADMIN']

/**
 * One group (spec §47): today's shared progress by default, earlier dates
 * via the date picker (from the first date this member may view), and
 * membership. Only group-visible fields ever reach this page; the database
 * returns nothing else.
 */
export function GroupDetailPage() {
  const { groupId = '' } = useParams()
  const { profile } = useAccount()
  const timeZone = safeTimeZone(profile.timezone)
  const today = todayInTimeZone(timeZone)
  const groups = useMyGroups(profile.id)
  const group = groups.data?.find((item) => item.id === groupId) ?? null

  return (
    <Page>
      <Breadcrumb
        items={[{ label: 'Groups', to: ROUTES.groups }, { label: group?.name ?? 'Group' }]}
      />
      {/* Every state keeps a page heading; the loaded view renders its own. */}
      {(groups.isError || (!groups.isPending && !group)) && (
        <PageHeader eyebrow="Groups" title="Group" />
      )}
      {groups.isError ? (
        <ErrorState
          title="Group unavailable"
          description="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void groups.refetch()}>
              Retry
            </Button>
          }
        />
      ) : groups.isPending ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !group ? (
        <EmptyState
          icon={Users}
          title="This group isn’t available"
          description="You may have left or been removed, or the group no longer exists."
          action={
            <Button asChild variant="secondary">
              <Link to={ROUTES.groups}>Back to groups</Link>
            </Button>
          }
        />
      ) : (
        <GroupView group={group} userId={profile.id} today={today} timeZone={timeZone} />
      )}
    </Page>
  )
}

function GroupView({
  group,
  userId,
  today,
  timeZone,
}: {
  group: GroupSummary
  userId: string
  today: string
  timeZone: string
}) {
  const [params, setParams] = useSearchParams()
  const requested = resolveDateParam(params.get('date'), today).date
  const date = requested < group.historyFrom ? group.historyFrom : requested
  const members = useGroupMembers(userId, group.id)
  const day = useGroupDay(userId, group.id, date)
  const [leaving, setLeaving] = useState(false)
  const permissions = permissionsFor(group.myRole)

  const setDate = (next: string) => {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === today) copy.delete('date')
        else copy.set('date', next)
        return copy
      },
      { replace: true },
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'} ·{' '}
            {ROLE_LABELS[group.myRole]}
          </>
        }
        title={group.name}
        description={group.description ?? undefined}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              setLeaving(true)
            }}
          >
            <LogOut aria-hidden="true" />
            Leave group
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border px-4 py-3">
        <span className="label-mono text-muted-foreground">Join code</span>
        <span className="metric text-xl text-foreground">{formatGroupCode(group.code)}</span>
        <CopyCodeButton code={group.code} />
        <span className="text-xs text-muted-foreground sm:ml-auto">
          Share it to invite someone.
        </span>
      </div>

      <Section title={date === today ? 'Today' : formatDayLabel(date)}>
        <DayNav
          id="group-date"
          date={date}
          today={today}
          min={group.historyFrom}
          onChange={setDate}
        />
        {day.isError ? (
          <SectionError title="Shared progress unavailable" onRetry={() => void day.refetch()} />
        ) : day.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        ) : day.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No shared data for this date. A member’s data appears from the day they joined.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {day.data.map((member) => (
              <li key={member.userId} className="min-w-0">
                <MemberCard day={member} isMe={member.userId === userId} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Shared: calories and protein against each member’s own target, steps and workout status.
          Weight, body measurements, meals and workouts stay private.
          {permissions.hasExtendedHistory
            ? ' As a group ' +
              (group.myRole === 'ADMIN' ? 'admin' : 'leader') +
              ', you can view history from before you joined.'
            : ''}
        </p>
      </Section>

      <MembersSection group={group} userId={userId} timeZone={timeZone} members={members} />

      <LeaveDialog
        open={leaving}
        onOpenChange={setLeaving}
        group={group}
        userId={userId}
        members={members.data ?? null}
      />
    </>
  )
}

function MembersSection({
  group,
  userId,
  timeZone,
  members,
}: {
  group: GroupSummary
  userId: string
  timeZone: string
  members: ReturnType<typeof useGroupMembers>
}) {
  const permissions = permissionsFor(group.myRole)
  const { setRole } = useGroupMutations(userId)
  const [removing, setRemoving] = useState<GroupMember | null>(null)

  return (
    <Section title="Members" meta={members.data ? String(members.data.length) : undefined}>
      {members.isError ? (
        <SectionError title="Members unavailable" onRetry={() => void members.refetch()} />
      ) : members.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {members.data.map((member) => {
            const isMe = member.userId === userId
            const name = member.name ?? 'Member'
            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5"
              >
                <div className="min-w-0 flex-1 basis-full sm:basis-0">
                  <p className="truncate font-medium text-foreground">
                    {name}
                    {isMe && <span className="ml-2 label-mono text-muted-foreground">You</span>}
                  </p>
                  <p className="label-mono text-muted-foreground">
                    Joined {formatShortDate(todayInTimeZone(timeZone, new Date(member.joinedAt)))}
                  </p>
                </div>
                {permissions.canChangeRoles && !isMe ? (
                  <Select
                    value={member.role}
                    disabled={setRole.isPending}
                    onValueChange={(value) => {
                      setRole.mutate(
                        { groupId: group.id, userId: member.userId, role: value as GroupRole },
                        {
                          onSuccess: () => {
                            notify.success(
                              `${name} is now ${ROLE_LABELS[value as GroupRole].toLowerCase()}`,
                            )
                          },
                          onError: (error) => {
                            notify.error(friendlyGroupError(error, 'Couldn’t change the role.'))
                          },
                        },
                      )
                    }}
                  >
                    <SelectTrigger aria-label={`Role for ${name}`} className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="flex items-center gap-1.5 label-mono text-muted-foreground">
                    {member.role === 'ADMIN' && <Shield aria-hidden="true" className="size-3.5" />}
                    {ROLE_LABELS[member.role]}
                  </span>
                )}
                {permissions.canRemoveMembers && !isMe && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${name}`}
                    onClick={() => {
                      setRemoving(member)
                    }}
                  >
                    <UserMinus aria-hidden="true" />
                    Remove
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <RemoveDialog
        member={removing}
        groupId={group.id}
        userId={userId}
        onClose={() => {
          setRemoving(null)
        }}
      />
    </Section>
  )
}

function RemoveDialog({
  member,
  groupId,
  userId,
  onClose,
}: {
  member: GroupMember | null
  groupId: string
  userId: string
  onClose: () => void
}) {
  const { remove } = useGroupMutations(userId)
  const [error, setError] = useState<string | null>(null)
  const name = member?.name ?? 'this member'
  const close = () => {
    setError(null)
    onClose()
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent>
        <DialogHeader
          eyebrow="Remove member"
          title={`Remove ${name}?`}
          description="They lose access to the group immediately. Their own records are not affected."
        />
        {error && <InlineAlert>{error}</InlineAlert>}
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={remove.isPending}
            onClick={() => {
              if (!member) return
              remove.mutate(
                { groupId, userId: member.userId },
                {
                  onSuccess: () => {
                    notify.success(`${name} was removed`)
                    close()
                  },
                  onError: (caught) => {
                    setError(friendlyGroupError(caught, 'Couldn’t remove the member.'))
                  },
                },
              )
            }}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeaveDialog({
  open,
  onOpenChange,
  group,
  userId,
  members,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: GroupSummary
  userId: string
  members: GroupMember[] | null
}) {
  const navigate = useNavigate()
  const { leave } = useGroupMutations(userId)
  const [error, setError] = useState<string | null>(null)
  const outcome = members ? leaveOutcome(group.myRole, members) : { kind: 'leave' as const }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null)
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader
          eyebrow="Leave group"
          title={`Leave ${group.name}?`}
          description={
            outcome.kind === 'needs-another-admin'
              ? 'You are the only group admin. Make another member a group admin first (Members → role), then leave.'
              : outcome.kind === 'last-member'
                ? 'You are the only member, so leaving closes the group. Your own records are not affected.'
                : 'You lose access to the group’s shared progress immediately. Your own records are not affected.'
          }
        />
        {error && <InlineAlert>{error}</InlineAlert>}
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
            }}
          >
            {outcome.kind === 'needs-another-admin' ? 'Close' : 'Cancel'}
          </Button>
          {outcome.kind !== 'needs-another-admin' && (
            <Button
              disabled={leave.isPending}
              onClick={() => {
                leave.mutate(group.id, {
                  onSuccess: () => {
                    notify.success(`You left ${group.name}`)
                    onOpenChange(false)
                    void navigate(ROUTES.groups, { replace: true })
                  },
                  onError: (caught) => {
                    setError(friendlyGroupError(caught, 'Couldn’t leave the group.'))
                  },
                })
              }}
            >
              {leave.isPending ? 'Leaving…' : 'Leave group'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
