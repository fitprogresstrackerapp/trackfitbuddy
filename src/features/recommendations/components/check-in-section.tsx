import { useState, type SubmitEvent } from 'react'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMonthName, formatShortDate } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'

import { useMonthlyFeedback, useSaveFeedback } from '../api/recommendation-queries'
import { FEEDBACK_MAX, type MonthlyFeedback } from '../api/recommendation-data'
import { checkInState, friendlyFeedbackError } from '../lib/recommendation-logic'
import { feedbackSchema } from '../schemas'

interface CheckInSectionProps {
  userId: string
  today: string
}

/**
 * Monthly check-in (spec §31): one optional free-text field for the upcoming
 * recommendation, open from the 1st until this month's recommendation is
 * generated. The database enforces the window and the lock; the UI only
 * reflects them.
 */
export function CheckInSection({ userId, today }: CheckInSectionProps) {
  const feedback = useMonthlyFeedback(userId, today)
  const month = formatMonthName(today)
  const state = feedback.data ? checkInState(feedback.data) : null

  return (
    <Section
      title="Monthly check-in"
      meta={
        state?.kind === 'open' ? (
          <StatusBadge status="pending" label="Open" />
        ) : state ? (
          <StatusBadge status="locked" />
        ) : undefined
      }
    >
      {feedback.isError ? (
        <SectionError title="Check-in unavailable" onRetry={() => void feedback.refetch()} />
      ) : feedback.isPending || !state ? (
        <Skeleton className="h-40 w-full" />
      ) : state.kind === 'open' ? (
        <CheckInForm
          key={feedback.data.updatedAt ?? 'new'}
          feedback={feedback.data}
          userId={userId}
          today={today}
        />
      ) : state.kind === 'used' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-foreground-secondary">
            Your {month} check-in was used for your recommendation.
          </p>
          <blockquote className="border-l-2 border-border pl-3 text-sm break-words whitespace-pre-line text-foreground">
            {feedback.data.feedback}
          </blockquote>
        </div>
      ) : (
        <p className="text-sm text-foreground-secondary">
          This month’s recommendation has been generated. The next check-in opens on{' '}
          {formatShortDate(state.reopens)}.
        </p>
      )}
    </Section>
  )
}

function CheckInForm({
  feedback,
  userId,
  today,
}: {
  feedback: MonthlyFeedback
  userId: string
  today: string
}) {
  const save = useSaveFeedback(userId, today)
  const [text, setText] = useState(feedback.feedback ?? '')
  const [error, setError] = useState<string | undefined>()
  const [saveError, setSaveError] = useState<string | null>(null)
  const saved = feedback.feedback !== null

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (save.isPending) return
    setSaveError(null)
    const parsed = feedbackSchema.safeParse({ feedback: text })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    try {
      await save.mutateAsync({ month: feedback.month, feedback: parsed.data.feedback })
      notify.success('Check-in saved', 'It will be used for your next recommendation.')
    } catch (caught) {
      setSaveError(friendlyFeedbackError(caught))
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <FormField
        id="monthly-check-in"
        label="How did this cycle feel?"
        error={error}
        hint={
          <>
            Optional. What worked? What was difficult? Anything you want changed? {text.length}/
            {FEEDBACK_MAX}
          </>
        }
      >
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            maxLength={FEEDBACK_MAX}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
            disabled={save.isPending}
          />
        )}
      </FormField>
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save feedback'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {saved ? 'Saved. ' : ''}You can edit it until this month’s recommendation is generated.
        </p>
      </div>
    </form>
  )
}
