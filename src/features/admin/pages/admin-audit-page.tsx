import { ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmptyState } from '@/components/common/empty-state'
import { FormField } from '@/components/common/form-field'
import { SectionError } from '@/components/common/section-error'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { DatePicker, Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'

import {
  AUDIT_PAGE_SIZE,
  type AuditAction,
  type AuditEntry,
  type AuditFilters,
} from '../api/admin-data'
import { useAudit } from '../api/admin-queries'
import { Pagination } from '../components/admin-ui'
import {
  ACTION_LABELS,
  actionLabel,
  auditChanges,
  domainLabel,
  DOMAIN_LABELS,
} from '../lib/admin-logic'

const ANY = 'ANY'
const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Audit logs (spec §63): who changed what, when and why, filtered server-side
 * and paginated. Entries are append-only; PIN rows never contain PIN material.
 */
export function AdminAuditPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [action, setAction] = useState<string>(ANY)
  const [entity, setEntity] = useState<string>(ANY)
  const [actorInput, setActorInput] = useState('')
  const [targetInput, setTargetInput] = useState('')
  const [names, setNames] = useState({ actor: '', target: '' })
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<AuditEntry | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setNames({ actor: actorInput, target: targetInput })
      setPage(0)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [actorInput, targetInput])

  const filters: AuditFilters = {
    from,
    to,
    action: action === ANY ? null : (action as AuditAction),
    entity: entity === ANY ? null : entity,
    actor: names.actor,
    target: names.target,
  }
  const audit = useAudit(filters, page, AUDIT_PAGE_SIZE)
  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value)
      setPage(0)
    }

  return (
    <Page>
      <Breadcrumb items={[{ label: 'Admin', to: ROUTES.admin }, { label: 'Audit Logs' }]} />
      <PageHeader
        eyebrow="Control"
        title="Audit Logs"
        description="Every administrative change and correction: actor, action, target, time and reason."
      />

      <Section title="Filter">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField id="audit-from" label="From">
            {(control) => (
              <DatePicker
                {...control}
                value={from}
                onChange={(event) => {
                  reset(setFrom)(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField id="audit-to" label="To">
            {(control) => (
              <DatePicker
                {...control}
                value={to}
                onChange={(event) => {
                  reset(setTo)(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField id="audit-action" label="Action">
            {(control) => (
              <Select value={action} onValueChange={reset(setAction)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any action</SelectItem>
                  {(Object.keys(ACTION_LABELS) as AuditAction[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {ACTION_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField id="audit-domain" label="Domain">
            {(control) => (
              <Select value={entity} onValueChange={reset(setEntity)}>
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any domain</SelectItem>
                  {Object.entries(DOMAIN_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField id="audit-actor" label="Actor name">
            {(control) => (
              <Input
                {...control}
                type="search"
                autoComplete="off"
                value={actorInput}
                onChange={(event) => {
                  setActorInput(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField id="audit-target" label="Target user name">
            {(control) => (
              <Input
                {...control}
                type="search"
                autoComplete="off"
                value={targetInput}
                onChange={(event) => {
                  setTargetInput(event.target.value)
                }}
              />
            )}
          </FormField>
        </div>
      </Section>

      <Section title="Entries" meta={audit.data ? `${String(audit.data.total)} found` : undefined}>
        {audit.isError ? (
          <SectionError title="Audit unavailable" onRetry={() => void audit.refetch()} />
        ) : audit.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : audit.data.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit entries"
            description="Try a wider date range or fewer filters."
          />
        ) : (
          <>
            <ul className="divide-y divide-border border-y border-border">
              {audit.data.rows.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="grid w-full gap-x-4 gap-y-1 py-2.5 text-left text-sm hover:bg-surface-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:grid-cols-[10rem_9rem_1fr_1fr]"
                    onClick={() => {
                      setOpen(entry)
                    }}
                  >
                    <span className="label-mono text-muted-foreground">
                      {dateTime.format(new Date(entry.createdAt))}
                    </span>
                    <span className="font-medium text-foreground">{actionLabel(entry)}</span>
                    <span className="min-w-0 break-words text-foreground-secondary">
                      {domainLabel(entry.entityType)}
                      {entry.targetName ? ` · ${entry.targetName}` : ''}
                    </span>
                    <span className="min-w-0 break-words text-muted-foreground">
                      by {entry.actorName ?? 'System'}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={AUDIT_PAGE_SIZE}
              total={audit.data.total}
              onPage={setPage}
            />
          </>
        )}
      </Section>

      <AuditDetail
        entry={open}
        onClose={() => {
          setOpen(null)
        }}
      />
    </Page>
  )
}

function AuditDetail({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  const changes = entry ? auditChanges(entry) : []
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {entry && (
        <DialogContent size="md">
          <DialogHeader eyebrow={domainLabel(entry.entityType)} title={actionLabel(entry)} />
          <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Actor</dt>
              <dd className="text-foreground">{entry.actorName ?? 'System'}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd className="text-foreground">{entry.targetName ?? '—'}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="text-foreground">{dateTime.format(new Date(entry.createdAt))}</dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd className="break-words text-foreground">{entry.reason ?? '—'}</dd>
            </dl>
            {changes.length > 0 ? (
              <table className="w-full">
                <caption className="sr-only">Changed fields</caption>
                <thead>
                  <tr className="label-mono text-muted-foreground">
                    <th scope="col" className="pb-1 text-left font-normal">
                      Field
                    </th>
                    <th scope="col" className="pb-1 text-left font-normal">
                      Original
                    </th>
                    <th scope="col" className="pb-1 text-left font-normal">
                      Corrected
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border border-t border-border">
                  {changes.map((change) => (
                    <tr key={change.field}>
                      <td className="py-1.5 pr-2 text-foreground-secondary">{change.field}</td>
                      <td className="py-1.5 pr-2 break-all text-muted-foreground">
                        {change.original}
                      </td>
                      <td className="py-1.5 break-all text-foreground">{change.corrected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-muted-foreground">No field details for this entry.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
