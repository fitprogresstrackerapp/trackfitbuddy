import { useState, type ReactNode } from 'react'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { StatusBadge } from '@/components/data/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/input'
import { notify } from '@/lib/feedback'

import type { RecommendationStatus } from '../api/admin-data'
import { friendlyAdminError, RECOMMENDATION_LABELS } from '../lib/admin-logic'

/** Previous / page x of y / next. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        disabled={page === 0}
        onClick={() => {
          onPage(page - 1)
        }}
      >
        Previous
      </Button>
      <span className="label-mono text-muted-foreground">
        Page {page + 1} of {pages}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page + 1 >= pages}
        onClick={() => {
          onPage(page + 1)
        }}
      >
        Next
      </Button>
    </div>
  )
}

/** A compact label / value grid. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="label-mono text-muted-foreground">{item.label}</dt>
          <dd className="text-sm break-words text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? <StatusBadge status="active" /> : <StatusBadge status="locked" label="Inactive" />
}

export function ProfileBadge({ complete }: { complete: boolean }) {
  return complete ? (
    <StatusBadge status="completed" label="Complete" />
  ) : (
    <StatusBadge status="incomplete" />
  )
}

export function RecommendationBadge({ status }: { status: RecommendationStatus }) {
  if (status === 'NONE') return <span className="text-muted-foreground">None</span>
  return (
    <StatusBadge
      status={status === 'IN_REVIEW' ? 'pending' : 'active'}
      label={RECOMMENDATION_LABELS[status]}
    />
  )
}

/** Visible, restrained marker for admin-only actions. */
export function AdminCorrectionLabel() {
  return <span className="label-mono text-warning">Admin correction</span>
}

export function ReasonField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <FormField id={id} label="Reason" hint="Optional. Recorded in the audit log.">
      {(control) => (
        <Textarea
          {...control}
          rows={2}
          maxLength={500}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          disabled={disabled}
        />
      )}
    </FormField>
  )
}

export interface ChangeLine {
  label: string
  from: string
  to: string
}

export interface ReviewedCorrection {
  changes: ChangeLine[]
  apply: (reason: string | null) => Promise<void>
}

/**
 * The admin correction flow (spec §69): the original values (read-only), the
 * corrected fields, an optional reason, then an explicit confirmation listing
 * every change before anything is saved.
 */
export function CorrectionDialog({
  open,
  onOpenChange,
  title,
  original,
  review,
  children,
  successMessage = 'Correction saved',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  original: { label: string; value: string }[]
  /** Validates the form; null when a field is invalid (the form shows why). */
  review: () => ReviewedCorrection | null
  children: ReactNode
  successMessage?: string
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<ReviewedCorrection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const close = () => {
    setPending(null)
    setError(null)
    setReason('')
    onOpenChange(false)
  }

  async function apply() {
    if (!pending || saving) return
    setSaving(true)
    setError(null)
    try {
      await pending.apply(reason.trim() || null)
      notify.success(successMessage, 'Recorded in the audit log.')
      close()
    } catch (caught) {
      setError(friendlyAdminError(caught, 'Couldn’t save the correction. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {open && (
        <DialogContent size="md">
          <DialogHeader eyebrow="Admin correction" title={title} />
          <div className="flex max-h-[65dvh] flex-col gap-5 overflow-y-auto pr-1">
            <section aria-label="Original" className="flex flex-col gap-2">
              <h3 className="label-section text-foreground-secondary">Original</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border px-3 py-2.5 text-sm">
                {original.map((item) => (
                  <div key={item.label} className="contents">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="break-words text-foreground">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            {pending ? (
              <section aria-label="Confirm correction" className="flex flex-col gap-2">
                <h3 className="label-section text-foreground-secondary">Apply these changes?</h3>
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                  {pending.changes.map((change) => (
                    <li key={change.label} className="flex flex-wrap gap-x-2 px-3 py-2">
                      <span className="text-foreground-secondary">{change.label}:</span>
                      <span className="text-muted-foreground line-through">{change.from}</span>
                      <span aria-hidden="true">→</span>
                      <span className="text-foreground">{change.to}</span>
                    </li>
                  ))}
                </ul>
                {reason.trim() && (
                  <p className="text-sm text-foreground-secondary">Reason: {reason.trim()}</p>
                )}
              </section>
            ) : (
              <section aria-label="Corrected" className="flex flex-col gap-4">
                <h3 className="label-section text-foreground-secondary">Corrected</h3>
                {children}
                <ReasonField id="correction-reason" value={reason} onChange={setReason} />
              </section>
            )}
            {error && <InlineAlert>{error}</InlineAlert>}
          </div>
          <DialogFooter>
            {pending ? (
              <>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setPending(null)
                  }}
                >
                  Back
                </Button>
                <Button disabled={saving} onClick={() => void apply()}>
                  {saving ? 'Saving…' : 'Apply correction'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={close}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setError(null)
                    const reviewed = review()
                    if (!reviewed) return
                    if (reviewed.changes.length === 0) {
                      setError('Nothing changed. Edit a value to correct it.')
                      return
                    }
                    setPending(reviewed)
                  }}
                >
                  Review correction
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/** A confirmed, reasoned action (deactivate, delete…). */
export function ConfirmDialog({
  open,
  onOpenChange,
  eyebrow,
  title,
  description,
  confirmLabel,
  onConfirm,
  withReason = true,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eyebrow: string
  title: string
  description: string
  confirmLabel: string
  onConfirm: (reason: string | null) => Promise<void>
  withReason?: boolean
  children?: ReactNode
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const close = () => {
    setReason('')
    setError(null)
    onOpenChange(false)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      {open && (
        <DialogContent>
          <DialogHeader eyebrow={eyebrow} title={title} description={description} />
          <div className="flex flex-col gap-4">
            {children}
            {withReason && (
              <ReasonField
                id="confirm-reason"
                value={reason}
                onChange={setReason}
                disabled={working}
              />
            )}
            {error && <InlineAlert>{error}</InlineAlert>}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={working} onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={working}
              onClick={() => {
                setWorking(true)
                setError(null)
                onConfirm(reason.trim() || null)
                  .then(close)
                  .catch((caught: unknown) => {
                    setError(friendlyAdminError(caught, 'That didn’t work. Please try again.'))
                  })
                  .finally(() => {
                    setWorking(false)
                  })
              }}
            >
              {working ? 'Working…' : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
