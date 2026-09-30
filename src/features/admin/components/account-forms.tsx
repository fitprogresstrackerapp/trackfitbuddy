import { useState, type SubmitEvent } from 'react'
import { Link } from 'react-router'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Sheet,
  SheetContent,
  SheetHeader,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ROUTES } from '@/constants/routes'
import { formatIndianPhone } from '@/features/auth/lib/phone'
import type { AppRole } from '@/features/auth/types'
import { notify } from '@/lib/feedback'

import { useAdminMutations } from '../api/admin-queries'
import { creatableRoles, friendlyAdminError, ROLE_LABELS } from '../lib/admin-logic'
import { createUserSchema, resetPinSchema } from '../schemas'
import { ReasonField } from './admin-ui'

/**
 * PIN field: masked, numeric, never autofilled, never logged or shown again.
 * The value goes only to the admin-users Edge Function (bcrypt server-side).
 */
function PinInput({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error: string | undefined
  disabled?: boolean
}) {
  return (
    <FormField
      id={id}
      label={label}
      hint="Exactly 4 digits. Share it with the user in person."
      error={error}
    >
      {(control) => (
        <Input
          {...control}
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={4}
          value={value}
          onChange={(event) => {
            onChange(event.target.value.replace(/\D/g, ''))
          }}
          disabled={disabled}
        />
      )}
    </FormField>
  )
}

export function ResetPinDialog({
  open,
  onOpenChange,
  userId,
  name,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  name: string
}) {
  const { pin: reset } = useAdminMutations(userId)
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saveError, setSaveError] = useState<string | null>(null)
  const close = () => {
    setPin('')
    setReason('')
    setError(undefined)
    setSaveError(null)
    onOpenChange(false)
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reset.isPending) return
    const parsed = resetPinSchema.safeParse({ pin, reason })
    if (!parsed.success) {
      setError(parsed.error.issues.find((issue) => issue.path[0] === 'pin')?.message)
      return
    }
    setError(undefined)
    setSaveError(null)
    try {
      await reset.mutateAsync(parsed.data)
      notify.success('PIN reset', `${name} can sign in with the new PIN.`)
      close()
    } catch (caught) {
      setSaveError(friendlyAdminError(caught, 'Couldn’t reset the PIN. Please try again.'))
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
        <DialogContent>
          <DialogHeader
            eyebrow="Account"
            title={`Reset PIN for ${name}`}
            description="The current PIN is never shown. The new PIN replaces it immediately and the reset is audited."
          />
          <form
            id="reset-pin-form"
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
            className="flex flex-col gap-4"
          >
            <PinInput
              id="reset-pin"
              label="New PIN"
              value={pin}
              onChange={setPin}
              error={error}
              disabled={reset.isPending}
            />
            <ReasonField
              id="reset-pin-reason"
              value={reason}
              onChange={setReason}
              disabled={reset.isPending}
            />
            {saveError && <InlineAlert>{saveError}</InlineAlert>}
          </form>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="reset-pin-form" disabled={reset.isPending}>
              {reset.isPending ? 'Resetting…' : 'Reset PIN'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/** Create a user (spec §5): phone, initial PIN and role; onboarding follows. */
export function CreateUserSheet({
  open,
  onOpenChange,
  actorRoles,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actorRoles: readonly AppRole[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <SheetHeader eyebrow="Users" title="Create user" />
          <CreateUserForm actorRoles={actorRoles} />
        </SheetContent>
      )}
    </Sheet>
  )
}

function CreateUserForm({ actorRoles }: { actorRoles: readonly AppRole[] }) {
  const { create } = useAdminMutations()
  const roles = creatableRoles(actorRoles)
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState<'USER' | 'MANAGER' | 'ADMIN'>('USER')
  const [errors, setErrors] = useState<{ phone?: string; pin?: string }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ userId: string; phone: string } | null>(null)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (create.isPending) return
    setSaveError(null)
    const parsed = createUserSchema.safeParse({ phone, pin, role })
    if (!parsed.success) {
      const next: { phone?: string; pin?: string } = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (key === 'phone' || key === 'pin') next[key] ??= issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    try {
      const result = await create.mutateAsync(parsed.data)
      setPin('')
      setCreated({ userId: result.user_id, phone: parsed.data.phone })
    } catch (caught) {
      setSaveError(friendlyAdminError(caught, 'Couldn’t create the user. Please try again.'))
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-5">
        <InlineAlert tone="info" title="User created">
          {formatIndianPhone(created.phone)} can now sign in with the PIN you set and complete
          onboarding.
        </InlineAlert>
        <Button asChild size="lg">
          <Link to={`${ROUTES.adminUsers}/${created.userId}`}>Open user</Link>
        </Button>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <FormField
        id="create-phone"
        label="Mobile number"
        hint="Indian mobile number; +91 is added."
        error={errors.phone}
      >
        {(control) => (
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value)
            }}
            disabled={create.isPending}
          />
        )}
      </FormField>
      <PinInput
        id="create-pin"
        label="Initial PIN"
        value={pin}
        onChange={setPin}
        error={errors.pin}
        disabled={create.isPending}
      />
      <FormField id="create-role" label="Role">
        {(control) => (
          <Select
            value={role}
            onValueChange={(value) => {
              setRole(value as 'USER' | 'MANAGER' | 'ADMIN')
            }}
          >
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((option) => (
                <SelectItem key={option} value={option}>
                  {ROLE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create user'}
      </Button>
    </form>
  )
}
