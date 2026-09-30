import { ChevronRight, Plus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccount } from '@/features/auth/auth-context'

import type { GroupSummary } from '../api/groups-data'
import { useMyGroups } from '../api/groups-queries'
import { CreateGroupSheet, JoinGroupSheet } from '../components/group-sheets'
import { groupPath, ROLE_LABELS } from '../lib/groups-logic'

/**
 * Groups (spec §46): the user's groups, and creating or joining one. Groups
 * are for shared accountability, not competition: no rankings or scores.
 */
export function GroupsPage() {
  const { profile } = useAccount()
  const groups = useMyGroups(profile.id)
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<'create' | 'join' | null>(null)
  const close = (open: boolean) => {
    if (!open) setSheet(null)
  }
  const openCreate = () => {
    setSheet('create')
  }
  const openJoin = () => {
    setSheet('join')
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Shared"
        title="Groups"
        description="See how the people in your group are doing today."
        actions={
          groups.data && groups.data.length > 0 ? (
            <>
              <Button variant="secondary" onClick={openJoin}>
                <UserPlus aria-hidden="true" />
                Join group
              </Button>
              <Button onClick={openCreate}>
                <Plus aria-hidden="true" />
                Create group
              </Button>
            </>
          ) : undefined
        }
      />

      <Section title="Your groups" meta={groups.data ? String(groups.data.length) : undefined}>
        {groups.isError ? (
          <ErrorState
            title="Groups unavailable"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => void groups.refetch()}>
                Retry
              </Button>
            }
          />
        ) : groups.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : groups.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title="You are not in any groups yet."
            description="Create a group and share its code, or join one with a code from a member."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={openCreate}>
                  <Plus aria-hidden="true" />
                  Create group
                </Button>
                <Button variant="secondary" onClick={openJoin}>
                  <UserPlus aria-hidden="true" />
                  Join group
                </Button>
              </div>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.data.map((group) => (
              <li key={group.id} className="min-w-0">
                <GroupCard group={group} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <CreateGroupSheet open={sheet === 'create'} onOpenChange={close} userId={profile.id} />
      <JoinGroupSheet
        open={sheet === 'join'}
        onOpenChange={close}
        userId={profile.id}
        onJoined={(groupId) => {
          setSheet(null)
          void navigate(groupPath(groupId))
        }}
      />
    </Page>
  )
}

function GroupCard({ group }: { group: GroupSummary }) {
  return (
    <Link
      to={groupPath(group.id)}
      className="group flex h-full flex-col gap-3 rounded-md border border-border bg-surface-1 px-4 py-3.5 transition-colors hover:border-foreground-secondary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 heading-block break-words text-foreground">{group.name}</span>
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        />
      </div>
      {group.description && (
        <p className="line-clamp-2 text-sm break-words text-foreground-secondary">
          {group.description}
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 label-mono text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users aria-hidden="true" className="size-3.5" />
          {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
        </span>
        <span>{ROLE_LABELS[group.myRole]}</span>
      </div>
    </Link>
  )
}
