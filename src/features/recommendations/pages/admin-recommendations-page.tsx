import { Play, RefreshCw, RotateCcw, Send } from 'lucide-react'
import { useMemo, useState } from 'react'

import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/choice'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { useAccount } from '@/features/auth/auth-context'
import {
  formatMonthName,
  formatShortDate,
  safeTimeZone,
  todayInTimeZone,
} from '@/lib/dates/local-date'
import { formatNumber, NO_VALUE } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  HISTORY_PAGE_SIZE,
  PROCESSING_STATES,
  processingErrorMessage,
  type AiUsage,
  type OverviewUser,
  type ProcessingCommand,
  type ProcessingResult,
  type ProcessingState,
} from '../api/admin-data'
import {
  useAiUsage,
  useAttemptHistory,
  useProcessingOverview,
  useRunProcessing,
} from '../api/recommendation-queries'
import { monthOf } from '../api/recommendation-data'
import {
  countStates,
  formatMoney,
  readinessLines,
  STATE_BADGES,
  stateReason,
} from '../lib/recommendation-logic'

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const MODE_LABELS: Record<string, string> = {
  PROCESS: 'Process',
  RETRY: 'Retry',
  REPROCESS: 'Reprocess',
}

/**
 * Monthly AI recommendation processing (spec §42; Prompt 10 §44–49, §77,
 * §107). Operational, not decorative: readiness, actions, AI usage against
 * the budget, and the attempt history. Every action is a command to the
 * process-recommendations Edge Function, which re-checks the admin role, the
 * budget and eligibility on the server.
 */
export function AdminRecommendationsPage() {
  const { profile } = useAccount()
  const today = todayInTimeZone(safeTimeZone(profile.timezone))
  const month = monthOf(today)

  const overview = useProcessingOverview()
  const usage = useAiUsage(month)
  const [page, setPage] = useState(0)
  const attempts = useAttemptHistory(page)
  const [filter, setFilter] = useState<ProcessingState | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirmReprocess, setConfirmReprocess] = useState(false)
  const [result, setResult] = useState<ProcessingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const processing = useRunProcessing()
  const busy = processing.isPending

  const users = useMemo(() => overview.data ?? [], [overview.data])
  const counts = countStates(users)
  const visible = filter ? users.filter((user) => user.state === filter) : users
  const selectedIds = users.filter((user) => selected.has(user.userId)).map((user) => user.userId)
  const failedIds = users.filter((user) => user.state === 'FAILED').map((user) => user.userId)

  function run(command: ProcessingCommand) {
    setError(null)
    setResult(null)
    processing.mutate(command, {
      onSuccess: (outcome) => {
        setResult(outcome)
        setSelected(new Set())
      },
      onError: (caught) => {
        setError(processingErrorMessage(caught))
      },
    })
  }

  function toggle(userId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(userId)
      else next.delete(userId)
      return next
    })
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((user) => selected.has(user.userId))

  return (
    <Page>
      <Breadcrumb items={[{ label: 'Admin', to: ROUTES.admin }, { label: 'Recommendations' }]} />
      <PageHeader
        eyebrow={`Monthly processing · ${formatMonthName(today)} ${today.slice(0, 4)}`}
        title="Recommendations"
        description="Generate each user's monthly recommendation. Only ready users are processed; every attempt is kept."
      />

      <Section title="Summary" meta={overview.isFetching ? 'Updating…' : undefined}>
        {overview.isError ? (
          <SectionError
            title="Processing status unavailable"
            onRetry={() => void overview.refetch()}
          />
        ) : overview.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div
            role="group"
            aria-label="Filter users by status"
            className="grid grid-cols-4 gap-2 xl:grid-cols-7"
          >
            {PROCESSING_STATES.map((state) => (
              <button
                key={state}
                type="button"
                aria-pressed={filter === state}
                onClick={() => {
                  setFilter((current) => (current === state ? null : state))
                }}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-md border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  filter === state && 'border-primary/60 bg-surface-2',
                )}
              >
                <span className="label-mono text-muted-foreground">
                  {STATE_BADGES[state].label}
                </span>
                <span className="metric text-2xl text-foreground">
                  {formatNumber(counts[state])}
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || counts.READY === 0}
            onClick={() => {
              run({ action: 'start', mode: 'PROCESS', process_all_ready: true })
            }}
          >
            <Play aria-hidden="true" />
            Process all ready ({counts.READY})
          </Button>
          <Button
            variant="secondary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => {
              run({ action: 'start', mode: 'PROCESS', user_ids: selectedIds })
            }}
          >
            <Send aria-hidden="true" />
            Process selected ({selectedIds.length})
          </Button>
          <Button
            variant="secondary"
            disabled={busy || failedIds.length === 0}
            onClick={() => {
              run({ action: 'start', mode: 'RETRY', user_ids: failedIds })
            }}
          >
            <RotateCcw aria-hidden="true" />
            Retry failed ({failedIds.length})
          </Button>
          <Button
            variant="secondary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => {
              setConfirmReprocess(true)
            }}
          >
            <RefreshCw aria-hidden="true" />
            Reprocess selected ({selectedIds.length})
          </Button>
          {counts.PENDING > 0 && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                run({ action: 'continue' })
              }}
            >
              <Play aria-hidden="true" />
              Continue pending ({counts.PENDING})
            </Button>
          )}
        </div>
        {busy && (
          <p role="status" className="text-sm text-foreground-secondary">
            Processing… users are generated one batch at a time.
          </p>
        )}
        {error && <InlineAlert title="Processing did not start">{error}</InlineAlert>}
        {result && <ResultSummary result={result} />}
      </Section>

      <Section title="AI usage" meta={formatMonthName(today)}>
        {usage.isError ? (
          <SectionError title="AI usage unavailable" onRetry={() => void usage.refetch()} />
        ) : usage.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <UsageSummary usage={usage.data} />
        )}
      </Section>

      <Section
        title="Users"
        meta={
          filter
            ? `${STATE_BADGES[filter].label} · ${String(visible.length)}`
            : `${String(users.length)} users`
        }
      >
        {overview.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users in this status.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Users and their processing status this month</caption>
              <thead>
                <tr className="label-mono text-muted-foreground">
                  <th scope="col" className="w-8 pb-2 text-left font-normal">
                    <Checkbox
                      aria-label="Select all shown users"
                      checked={allVisibleSelected}
                      onCheckedChange={(checked) => {
                        for (const user of visible) toggle(user.userId, checked === true)
                      }}
                    />
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    User
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Status
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Readiness / reason
                  </th>
                  <th scope="col" className="pb-2 text-left font-normal">
                    Last recommendation
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border border-t border-border">
                {visible.map((user) => (
                  <UserRow
                    key={user.userId}
                    user={user}
                    checked={selected.has(user.userId)}
                    onCheckedChange={(checked) => {
                      toggle(user.userId, checked)
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="History"
        meta={attempts.data ? `${formatNumber(attempts.data.total)} attempts` : undefined}
      >
        {attempts.isError ? (
          <SectionError title="History unavailable" onRetry={() => void attempts.refetch()} />
        ) : attempts.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : attempts.data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No processing attempts yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <caption className="sr-only">Processing attempts, newest first</caption>
                <thead>
                  <tr className="label-mono text-muted-foreground">
                    <th scope="col" className="pb-2 text-left font-normal">
                      Date
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      User
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Action
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Status
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Model
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Prompt
                    </th>
                    <th scope="col" className="pb-2 text-right font-normal">
                      Tokens
                    </th>
                    <th scope="col" className="pb-2 text-right font-normal">
                      Est. cost
                    </th>
                    <th scope="col" className="pb-2 pl-4 text-left font-normal">
                      Reason
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border border-t border-border">
                  {attempts.data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {dateTime.format(new Date(row.createdAt))}
                      </td>
                      <td className="py-2.5 pr-3 text-foreground">{row.userName ?? 'Unnamed'}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {MODE_LABELS[row.mode] ?? row.mode} · #{row.attempt}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge {...STATE_BADGES[row.status]} />
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {row.provider ? `${row.provider} / ${row.model ?? NO_VALUE}` : NO_VALUE}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {row.promptVersion ?? NO_VALUE}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-foreground tabular-nums">
                        {row.totalTokens ? formatNumber(row.totalTokens) : NO_VALUE}
                      </td>
                      <td className="py-2.5 text-right text-foreground tabular-nums">
                        {row.estimatedCost === null
                          ? NO_VALUE
                          : formatMoney(row.estimatedCost, row.currency)}
                      </td>
                      <td className="py-2.5 pl-4 text-foreground-secondary">{row.reason ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => {
                  setPage((current) => Math.max(0, current - 1))
                }}
              >
                Previous
              </Button>
              <span className="label-mono text-muted-foreground">
                Page {page + 1} of {Math.max(1, Math.ceil(attempts.data.total / HISTORY_PAGE_SIZE))}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={(page + 1) * HISTORY_PAGE_SIZE >= attempts.data.total}
                onClick={() => {
                  setPage((current) => current + 1)
                }}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Section>

      <Dialog open={confirmReprocess} onOpenChange={setConfirmReprocess}>
        <DialogContent>
          <DialogHeader
            eyebrow="Reprocess"
            title={`Reprocess ${String(selectedIds.length)} ${selectedIds.length === 1 ? 'user' : 'users'}?`}
            description="A new recommendation is generated for users who already have one this month. The previous recommendation is kept in history and marked replaced; users without one are skipped."
          />
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmReprocess(false)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmReprocess(false)
                run({ action: 'start', mode: 'REPROCESS', user_ids: selectedIds })
              }}
            >
              Reprocess
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  )
}

function UserRow({
  user,
  checked,
  onCheckedChange,
}: {
  user: OverviewUser
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const badge = STATE_BADGES[user.state]
  const reason = stateReason(user)
  const name = user.name ?? 'Unnamed user'
  return (
    <tr>
      <td className="py-2.5 align-top">
        <Checkbox
          aria-label={`Select ${name}`}
          checked={checked}
          onCheckedChange={(value) => {
            onCheckedChange(value === true)
          }}
        />
      </td>
      <td className="py-2.5 pr-3 align-top font-medium text-foreground">{name}</td>
      <td className="py-2.5 pr-3 align-top">
        <StatusBadge status={badge.status} label={badge.label} />
      </td>
      <td className="py-2.5 pr-3 align-top text-foreground-secondary">
        {user.state === 'READY' ? readinessLines(user).join(' · ') : (reason ?? '')}
      </td>
      <td className="py-2.5 align-top whitespace-nowrap text-foreground-secondary">
        {user.lastRecommendation ? formatShortDate(user.lastRecommendation) : NO_VALUE}
      </td>
    </tr>
  )
}

function ResultSummary({ result }: { result: ProcessingResult }) {
  const { batch } = result
  const parts = [
    `${String(batch.success)} successful`,
    `${String(batch.failed)} failed`,
    `${String(batch.skipped + result.skipped_at_queue)} skipped`,
  ]
  if (result.pending > 0) parts.push(`${String(result.pending)} pending`)
  return (
    <div className="flex flex-col gap-2" role="status">
      <InlineAlert
        tone={batch.failed > 0 || batch.errors > 0 ? 'warning' : 'info'}
        title="Processing finished"
      >
        {parts.join(' · ')}.
        {batch.errors > 0 && ` ${String(batch.errors)} could not be processed and remain pending.`}
      </InlineAlert>
      {batch.stopped_by_budget && (
        <InlineAlert tone="warning" title="Monthly AI budget reached">
          Remaining users stay pending until the budget is raised or the next budget month.
        </InlineAlert>
      )}
    </div>
  )
}

function UsageSummary({ usage }: { usage: AiUsage }) {
  const items: { label: string; value: string }[] = [
    {
      label: 'Monthly budget',
      value: usage.budget === null ? 'Not set' : formatMoney(usage.budget, usage.currency),
    },
    { label: 'Estimated spend', value: formatMoney(usage.estimatedSpend, usage.currency) },
    {
      label: 'Remaining',
      value: usage.remaining === null ? NO_VALUE : formatMoney(usage.remaining, usage.currency),
    },
    { label: 'Users processed', value: formatNumber(usage.usersProcessed) },
    { label: 'Requests', value: formatNumber(usage.requests) },
    { label: 'Tokens', value: formatNumber(usage.totalTokens) },
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 bg-background px-3 py-2.5">
            <dt className="label-mono text-muted-foreground">{item.label}</dt>
            <dd className="text-lg text-foreground tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Costs are estimated from the configured model pricing
        {usage.actualSpend !== null
          ? `; provider-reported: ${formatMoney(usage.actualSpend, usage.currency)}`
          : ''}
        .
        {usage.reserved > 0 &&
          ` ${formatMoney(usage.reserved, usage.currency)} is reserved by running attempts.`}
        {usage.models.length > 0 && ` Models: ${usage.models.join(', ')}.`}
      </p>
    </div>
  )
}
