import { KeyRound, Pencil, Power, UserX } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { DayNav } from '@/components/common/day-nav'
import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { SectionError } from '@/components/common/section-error'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { useAccount } from '@/features/auth/auth-context'
import { formatIndianPhone } from '@/features/auth/lib/phone'
import { ADMIN_ROLES, hasAnyRole } from '@/features/auth/lib/roles'
import { ACTIVITY_LEVEL_LABELS, focusLabel, longTermGoalLabel } from '@/features/profile/lib/goals'
import { GENDER_OPTIONS } from '@/features/profile/schemas'
import { resolveDateParam } from '@/lib/dates/day-param'
import {
  ageOn,
  formatDayLabel,
  formatShortDate,
  safeTimeZone,
  todayInTimeZone,
} from '@/lib/dates/local-date'
import { formatNumber, NO_VALUE } from '@/lib/format'
import { notify } from '@/lib/feedback'

import type { UserAccount } from '../api/admin-data'
import { useActiveGoal, useAdminMutations, useAudit, useUserAccount } from '../api/admin-queries'
import {
  ActiveBadge,
  ConfirmDialog,
  Facts,
  ProfileBadge,
  RecommendationBadge,
} from '../components/admin-ui'
import { ResetPinDialog } from '../components/account-forms'
import { ProfileCorrection } from '../components/corrections'
import { BodySection, DayRecordsSections, RecommendationsSection } from '../components/user-records'
import {
  actionLabel,
  auditChanges,
  domainLabel,
  PROFILE_FIELD_LABELS,
  ROLE_LABELS,
} from '../lib/admin-logic'

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * One user (spec §79): account, profile, a day's records, body, recommendation
 * history and (admins) the user's audit trail. Actions and corrections appear
 * only when the server says this admin may administer the account; managers
 * see their assigned users read-only.
 */
export function AdminUserDetailPage() {
  const { userId = '' } = useParams()
  const account = useUserAccount(userId)

  return (
    <Page>
      <Breadcrumb
        items={[
          { label: 'Admin', to: ROUTES.admin },
          { label: 'Users', to: ROUTES.adminUsers },
          { label: account.data?.name ?? 'User' },
        ]}
      />
      {account.isPending ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : account.isError || !account.data ? (
        <>
          <PageHeader eyebrow="Users" title="User" />
          {account.isError && (account.error as { code?: string }).code !== '42501' ? (
            <ErrorState
              title="User unavailable"
              description="Check your connection and try again."
              action={
                <Button variant="secondary" onClick={() => void account.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="This user isn’t available"
              description="The account doesn’t exist or isn’t assigned to you."
              action={
                <Button asChild variant="secondary">
                  <Link to={ROUTES.adminUsers}>Back to users</Link>
                </Button>
              }
            />
          )}
        </>
      ) : (
        <UserView account={account.data} />
      )}
    </Page>
  )
}

function UserView({ account }: { account: UserAccount }) {
  const { roles: myRoles } = useAccount()
  const isAdmin = hasAnyRole(myRoles, ADMIN_ROLES)
  const today = todayInTimeZone(safeTimeZone(account.timezone))
  const [params, setParams] = useSearchParams()
  const date = resolveDateParam(params.get('date'), today).date
  const goal = useActiveGoal(account.userId, true)
  const { status } = useAdminMutations(account.userId)
  const [dialog, setDialog] = useState<'pin' | 'status' | 'profile' | null>(null)
  const name = account.name ?? 'This user'
  const gender = GENDER_OPTIONS.find((option) => option.value === account.gender)?.label ?? NO_VALUE

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
        eyebrow={account.roles.map((role) => ROLE_LABELS[role]).join(' · ')}
        title={account.name ?? 'Not onboarded'}
        description={formatIndianPhone(account.phone)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActiveBadge active={account.isActive} />
            <ProfileBadge complete={account.missingFields.length === 0} />
          </div>
        }
      />

      {account.canAdminister && (
        <div role="group" aria-label="Account actions" className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDialog('pin')
            }}
          >
            <KeyRound aria-hidden="true" />
            Reset PIN
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDialog('status')
            }}
          >
            {account.isActive ? <UserX aria-hidden="true" /> : <Power aria-hidden="true" />}
            {account.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      )}
      {!account.canAdminister && (
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'You can view this account but not change it (admin accounts are managed by a super admin).'
            : 'Read-only: you can view this assigned user; changes are made by an admin.'}
        </p>
      )}

      <Section title="Account">
        <Facts
          items={[
            {
              label: 'Created',
              value: formatShortDate(
                todayInTimeZone(safeTimeZone(account.timezone), new Date(account.createdAt)),
              ),
            },
            {
              label: 'Last activity',
              value: account.lastActivity ? formatShortDate(account.lastActivity) : NO_VALUE,
            },
            {
              label: 'Recommendation',
              value: <RecommendationBadge status={account.recommendationStatus} />,
            },
            {
              label: 'Status',
              value: account.isActive
                ? 'Active'
                : `Deactivated${account.deactivatedAt ? ` ${formatShortDate(todayInTimeZone(safeTimeZone(account.timezone), new Date(account.deactivatedAt)))}` : ''}${account.deactivatedByName ? ` by ${account.deactivatedByName}` : ''}`,
            },
            { label: 'Timezone', value: account.timezone },
          ]}
        />
      </Section>

      <Section
        title="Profile"
        action={
          account.canAdminister ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDialog('profile')
              }}
            >
              <Pencil aria-hidden="true" />
              Admin correction
            </Button>
          ) : undefined
        }
      >
        {account.missingFields.length > 0 && (
          <p className="text-sm text-warning">
            Missing required:{' '}
            {account.missingFields.map((field) => PROFILE_FIELD_LABELS[field] ?? field).join(', ')}
          </p>
        )}
        <Facts
          items={[
            {
              label: 'Age',
              value: account.dateOfBirth
                ? `${String(ageOn(account.dateOfBirth, today))} (${account.dateOfBirth})`
                : NO_VALUE,
            },
            { label: 'Gender', value: gender },
            {
              label: 'Height',
              value:
                account.heightCm === null ? NO_VALUE : `${formatNumber(account.heightCm, 1)} cm`,
            },
            {
              label: 'Activity level',
              value: account.activityLevel
                ? (ACTIVITY_LEVEL_LABELS[account.activityLevel] ?? account.activityLevel)
                : 'Not set',
            },
            {
              label: 'Workout capacity',
              value:
                account.workoutDaysPerWeek === null
                  ? 'Not set'
                  : `${String(account.workoutDaysPerWeek)} days / week`,
            },
            {
              label: 'Goal',
              value: goal.isPending
                ? '…'
                : goal.data
                  ? `${longTermGoalLabel(goal.data.longTermGoal)}${goal.data.focuses.length > 0 ? ` · ${goal.data.focuses.map(focusLabel).join(', ')}` : ''}`
                  : 'Not set',
            },
            { label: 'Job', value: account.job ?? 'Not set' },
            { label: 'Hobbies', value: account.hobbies ?? 'Not set' },
          ]}
        />
      </Section>

      <Section title={date === today ? 'Records · today' : `Records · ${formatDayLabel(date)}`}>
        <DayNav id="admin-date" date={date} today={today} onChange={setDate} />
        <DayRecordsSections
          userId={account.userId}
          date={date}
          canAdminister={account.canAdminister}
        />
      </Section>

      <BodySection userId={account.userId} canAdminister={account.canAdminister} />
      <RecommendationsSection userId={account.userId} />
      {isAdmin && <UserAudit userId={account.userId} />}

      {account.canAdminister && (
        <>
          <ResetPinDialog
            open={dialog === 'pin'}
            onOpenChange={(open) => {
              if (!open) setDialog(null)
            }}
            userId={account.userId}
            name={name}
          />
          <ConfirmDialog
            open={dialog === 'status'}
            onOpenChange={(open) => {
              if (!open) setDialog(null)
            }}
            eyebrow="Account"
            title={account.isActive ? `Deactivate ${name}?` : `Activate ${name}?`}
            description={
              account.isActive
                ? 'They can no longer sign in or use the app. Nothing is deleted: all records, history and audit stay intact, and the account can be activated again.'
                : 'They can sign in again and see all their records.'
            }
            confirmLabel={account.isActive ? 'Deactivate' : 'Activate'}
            onConfirm={async (reason) => {
              await status.mutateAsync({ active: !account.isActive, reason })
              notify.success(account.isActive ? 'Account deactivated' : 'Account activated')
            }}
          />
          {dialog === 'profile' && (
            <ProfileCorrection
              open
              onOpenChange={(open) => {
                if (!open) setDialog(null)
              }}
              userId={account.userId}
              account={account}
            />
          )}
        </>
      )}
    </>
  )
}

function UserAudit({ userId }: { userId: string }) {
  const audit = useAudit(
    { from: '', to: '', action: null, entity: null, actor: '', target: '', targetUserId: userId },
    0,
    10,
  )
  return (
    <Section
      title="Audit history"
      action={
        <Button asChild variant="link" className="text-sm">
          <Link to={ROUTES.adminAudit}>All audit</Link>
        </Button>
      }
    >
      {audit.isError ? (
        <SectionError title="Audit unavailable" onRetry={() => void audit.refetch()} />
      ) : audit.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : audit.data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit entries for this user.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {audit.data.rows.map((entry) => {
            const changes = auditChanges(entry)
            return (
              <li key={entry.id} className="flex flex-col gap-1 py-2.5 text-sm">
                <p className="text-foreground">
                  <span className="font-medium">{actionLabel(entry)}</span> ·{' '}
                  {domainLabel(entry.entityType)}
                  <span className="ml-2 label-mono text-muted-foreground">
                    {dateTime.format(new Date(entry.createdAt))} · {entry.actorName ?? 'System'}
                  </span>
                </p>
                {changes.length > 0 && (
                  <p className="text-foreground-secondary">
                    {changes
                      .slice(0, 3)
                      .map((change) => `${change.field}: ${change.original} → ${change.corrected}`)
                      .join(' · ')}
                  </p>
                )}
                {entry.reason && <p className="text-muted-foreground">Reason: {entry.reason}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
