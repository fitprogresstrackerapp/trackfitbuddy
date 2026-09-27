import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { LOGIN_ERROR_MESSAGES, LoginError } from '../api/pin-login'
import { useAuth, type SignedOutReason } from '../auth-context'
import { INDIA_COUNTRY_CODE } from '../lib/phone'
import { loginSchema, PIN_LENGTH } from '../schemas'

type FieldErrors = Partial<Record<'phone' | 'pin', string>>

const SIGNED_OUT_MESSAGES: Record<Exclude<SignedOutReason, 'logout'>, string> = {
  disabled: LOGIN_ERROR_MESSAGES.ACCOUNT_DISABLED,
  expired: 'Your session ended. Log in again to continue.',
}

export function LoginPage() {
  const { state, signIn } = useAuth()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const signedOutReason =
    state.status === 'signed_out' && state.reason !== 'logout' ? state.reason : null

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setFormError(null)

    const parsed = loginSchema.safeParse({ phone, pin })
    if (!parsed.success) {
      const { fieldErrors: errors } = z.flattenError(parsed.error)
      setFieldErrors({ phone: errors.phone?.[0], pin: errors.pin?.[0] })
      return
    }
    setFieldErrors({})

    setSubmitting(true)
    try {
      await signIn(parsed.data)
      // Navigation happens in GuestOnly once the account has loaded.
    } catch (error) {
      setPin('')
      setFormError(LOGIN_ERROR_MESSAGES[error instanceof LoginError ? error.code : 'SERVER_ERROR'])
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-3">
        <p className="label-mono text-muted-foreground">Phone + PIN</p>
        <h1 className="heading-page text-foreground">Log in</h1>
        <p className="text-sm text-foreground-secondary">
          Use the phone number and PIN provided by your admin.
        </p>
      </header>

      {signedOutReason && !formError && (
        <InlineAlert tone="warning">{SIGNED_OUT_MESSAGES[signedOutReason]}</InlineAlert>
      )}

      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-5"
      >
        <FormField id="phone" label="Phone number" error={fieldErrors.phone}>
          {(control) => (
            <AdornedInput
              {...control}
              leading={INDIA_COUNTRY_CODE}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="98765 43210"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value)
              }}
              disabled={submitting}
            />
          )}
        </FormField>

        <FormField id="pin" label="PIN" hint="4 digits" error={fieldErrors.pin}>
          {(control) => (
            <Input
              {...control}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              maxLength={PIN_LENGTH}
              value={pin}
              onChange={(event) => {
                setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
              }}
              disabled={submitting}
              className="font-mono text-lg tracking-[0.5em]"
            />
          )}
        </FormField>

        {formError && <InlineAlert>{formError}</InlineAlert>}

        <Button type="submit" size="lg" className="mt-2 w-full" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Login'}
        </Button>
      </form>

      <p className="label-mono text-muted-foreground">Accounts are created by an admin</p>
    </div>
  )
}
