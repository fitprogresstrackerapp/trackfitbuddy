import { ChevronRight, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/common/empty-state'
import { FormField } from '@/components/common/form-field'
import { SectionError } from '@/components/common/section-error'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { formatIndianPhone } from '@/features/auth/lib/phone'
import { formatShortDate } from '@/lib/dates/local-date'
import { NO_VALUE } from '@/lib/format'

import { USERS_PAGE_SIZE, type AppRole, type UserFilters, type UserRow } from '../api/admin-data'
import { useUserList } from '../api/admin-queries'
import { ActiveBadge, Pagination, ProfileBadge, RecommendationBadge } from '../components/admin-ui'
import { CreateUserSheet } from '../components/account-forms'
import { creatableRoles, primaryRole, ROLE_LABELS } from '../lib/admin-logic'

const ANY = 'ANY'
const userPath = (userId: string) => `${ROUTES.adminUsers}/${userId}`

/**
 * Users (spec §79): server-side search, filters and pagination. Admins see
 * every account; managers only their assigned users (the database decides).
 * No health data here — it is on each user's page.
 */
export function AdminUsersPage() {
  const { roles } = useAccount()
  const isManagerOnly = creatableRoles(roles).length === 0
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [role, setRole] = useState<string>(ANY)
  const [status, setStatus] = useState<string>(ANY)
  const [profile, setProfile] = useState<string>(ANY)
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search)
      setPage(0)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [search])

  const filters: UserFilters = {
    search: debounced,
    role: role === ANY ? null : (role as AppRole),
    active: status === ANY ? null : status === 'ACTIVE',
    complete: profile === ANY ? null : profile === 'COMPLETE',
  }
  const users = useUserList(filters, page)
  const select = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setPage(0)
  }

  return (
    <Page>
      <Breadcrumb items={[{ label: 'Admin', to: ROUTES.admin }, { label: 'Users' }]} />
      <PageHeader
        eyebrow={isManagerOnly ? 'Assigned to you' : 'Control'}
        title="Users"
        description={
          isManagerOnly
            ? 'Users assigned to you. You can view their records; changes are made by an admin.'
            : 'Accounts, status and profile completeness. Open a user for records, corrections and audit.'
        }
        actions={
          isManagerOnly ? undefined : (
            <Button
              onClick={() => {
                setCreating(true)
              }}
            >
              <UserPlus aria-hidden="true" />
              Create user
            </Button>
          )
        }
      />

      <Section title="Find users">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="user-search" label="Name or phone">
            {(control) => (
              <Input
                {...control}
                type="search"
                autoComplete="off"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
              />
            )}
          </FormField>
          <FilterSelect
            id="user-role"
            label="Role"
            value={role}
            onChange={select(setRole)}
            options={[
              { value: ANY, label: 'Any role' },
              ...(['USER', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] as const).map((value) => ({
                value,
                label: ROLE_LABELS[value],
              })),
            ]}
          />
          <FilterSelect
            id="user-status"
            label="Status"
            value={status}
            onChange={select(setStatus)}
            options={[
              { value: ANY, label: 'Any status' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
          />
          <FilterSelect
            id="user-profile"
            label="Profile"
            value={profile}
            onChange={select(setProfile)}
            options={[
              { value: ANY, label: 'Any profile' },
              { value: 'COMPLETE', label: 'Complete' },
              { value: 'INCOMPLETE', label: 'Incomplete' },
            ]}
          />
        </div>
      </Section>

      <Section title="Users" meta={users.data ? `${String(users.data.total)} found` : undefined}>
        {users.isError ? (
          <SectionError title="Users unavailable" onRetry={() => void users.refetch()} />
        ) : users.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : users.data.rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No users found"
            description="Try a different search or filter."
          />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <caption className="sr-only">Users</caption>
                <thead>
                  <tr className="label-mono text-muted-foreground">
                    <th scope="col" className="pb-2 text-left font-normal">
                      Name
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Phone
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Role
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Status
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Profile
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Recommendation
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Last activity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border border-t border-border">
                  {users.data.rows.map((user) => (
                    <tr key={user.userId} className="hover:bg-surface-1">
                      <td className="py-2.5 pr-3">
                        <Link
                          to={userPath(user.userId)}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {user.name ?? 'Not onboarded'}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {formatIndianPhone(user.phone)}
                      </td>
                      <td className="py-2.5 pr-3 text-foreground-secondary">
                        {ROLE_LABELS[primaryRole(user.roles)]}
                      </td>
                      <td className="py-2.5 pr-3">
                        <ActiveBadge active={user.isActive} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <ProfileBadge complete={user.isProfileComplete} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <RecommendationBadge status={user.recommendationStatus} />
                      </td>
                      <td className="py-2.5 whitespace-nowrap text-foreground-secondary">
                        {user.lastActivity ? formatShortDate(user.lastActivity) : NO_VALUE}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border border-y border-border md:hidden">
              {users.data.rows.map((user) => (
                <li key={user.userId}>
                  <UserListItem user={user} />
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={USERS_PAGE_SIZE}
              total={users.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Section>

      <CreateUserSheet open={creating} onOpenChange={setCreating} actorRoles={roles} />
    </Page>
  )
}

function UserListItem({ user }: { user: UserRow }) {
  return (
    <Link
      to={userPath(user.userId)}
      className="flex items-center gap-3 py-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate font-medium text-foreground">{user.name ?? 'Not onboarded'}</span>
        <span className="label-mono text-muted-foreground">
          {formatIndianPhone(user.phone)} · {ROLE_LABELS[primaryRole(user.roles)]}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <ActiveBadge active={user.isActive} />
          <ProfileBadge complete={user.isProfileComplete} />
        </span>
      </div>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <FormField id={id} label={label}>
      {(control) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...control}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  )
}
