import type { UseQueryResult } from '@tanstack/react-query'
import { Check, Pencil } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'

import { AdornedInput } from '@/components/common/adorned-input'
import { EmptyState } from '@/components/common/empty-state'
import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { formatShortDate } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'
import { formatNumber } from '@/lib/format'

import type { PlanData, Recommendation, Targets } from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { focusLabel, longTermGoalLabel } from '../lib/goals'
import { friendlyProfileError, isEdited, reviewState } from '../lib/profile-logic'
import { createReviewSchema, type ReviewInput } from '../schemas'
import { EditSheet } from './profile-ui'

const TARGET_ROWS: readonly { key: keyof Targets; label: string; unit: string; digits: number }[] =
  [
    { key: 'calories', label: 'Calories', unit: 'kcal', digits: 0 },
    { key: 'proteinG', label: 'Protein', unit: 'g', digits: 1 },
    { key: 'carbsG', label: 'Carbs', unit: 'g', digits: 1 },
    { key: 'fatG', label: 'Fat', unit: 'g', digits: 1 },
    { key: 'fiberG', label: 'Fiber', unit: 'g', digits: 1 },
  ]

const REVIEW_WARNING = 'Recommended target — change only if advised by your nutritionist or coach.'

interface PlanSectionProps {
  plan: UseQueryResult<PlanData>
  today: string
  mutations: ReturnType<typeof useProfileMutations>
}

/**
 * The current recommendation (spec §29–33): status, cycle dates, targets,
 * template and focus. During the review window the owner may adjust the final
 * targets and session names, or accept & lock; the server enforces the window.
 * The AI's original values are always shown next to edited ones.
 */
export function PlanSection({ plan, today, mutations }: PlanSectionProps) {
  const [sheet, setSheet] = useState<'review' | 'accept' | null>(null)
  const recommendation = plan.data?.recommendation ?? null
  const state = reviewState(recommendation, today)

  return (
    <Section
      title="Current plan"
      meta={
        state.kind === 'review' ? (
          <StatusBadge status="pending" label={`In review until ${formatShortDate(state.until)}`} />
        ) : state.kind === 'active' ? (
          <StatusBadge status="active" />
        ) : undefined
      }
    >
      {plan.isError ? (
        <SectionError title="Current plan unavailable" onRetry={() => void plan.refetch()} />
      ) : plan.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !recommendation ? (
        <EmptyState
          icon={ICONS.goals}
          title="No recommendation"
          description="Your targets and workout template appear after your first monthly recommendation."
        />
      ) : (
        <PlanDetails recommendation={recommendation} />
      )}

      {recommendation && state.kind === 'review' && (
        <div className="flex flex-col gap-3">
          <InlineAlert tone="info" title="Review window">
            You can adjust the final targets or accept this plan until{' '}
            {formatShortDate(state.until)}. It locks automatically afterwards.
          </InlineAlert>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setSheet('review')
              }}
            >
              <Pencil aria-hidden="true" />
              Review targets
            </Button>
            <Button
              onClick={() => {
                setSheet('accept')
              }}
            >
              <Check aria-hidden="true" />
              Accept & lock
            </Button>
          </div>
        </div>
      )}

      <EditSheet
        open={sheet === 'review' && recommendation !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        eyebrow="Review"
        title="Review targets"
      >
        {recommendation && (
          <ReviewForm
            recommendation={recommendation}
            onSave={async (values) => {
              try {
                await mutations.review.mutateAsync({ cycleId: recommendation.id, values })
              } catch (error) {
                throw new Error(
                  friendlyProfileError(error, 'Couldn’t save the targets. Please try again.'),
                  {
                    cause: error,
                  },
                )
              }
              setSheet(null)
              notify.success('Targets saved', 'The original recommendation is kept for reference.')
            }}
          />
        )}
      </EditSheet>

      <EditSheet
        open={sheet === 'accept' && recommendation !== null}
        onOpenChange={(open) => {
          if (!open) setSheet(null)
        }}
        eyebrow="Review"
        title="Accept & lock this plan?"
        description="The targets and template can’t be changed after locking."
      >
        {recommendation && (
          <AcceptConfirm
            onConfirm={async () => {
              try {
                await mutations.accept.mutateAsync(recommendation.id)
              } catch (error) {
                throw new Error(
                  friendlyProfileError(error, 'Couldn’t lock the plan. Please try again.'),
                  {
                    cause: error,
                  },
                )
              }
              setSheet(null)
              notify.success('Plan locked')
            }}
          />
        )}
      </EditSheet>
    </Section>
  )
}

function PlanDetails({ recommendation }: { recommendation: Recommendation }) {
  const templateEdited =
    recommendation.originalSessions !== null &&
    recommendation.originalSessions.join('\n') !== recommendation.sessions.join('\n')
  return (
    <div className="flex flex-col gap-5">
      <p className="label-mono text-muted-foreground">
        Recommendation cycle · {formatShortDate(recommendation.periodStart)} –{' '}
        {recommendation.periodEnd ? formatShortDate(recommendation.periodEnd) : 'ongoing'}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Daily targets for this cycle</caption>
            <thead>
              <tr className="label-mono text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-normal">
                  Target
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Final
                </th>
                <th scope="col" className="pb-2 text-right font-normal">
                  Recommended
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {TARGET_ROWS.map((row) => {
                const final = recommendation.final[row.key]
                const recommended = recommendation.recommended[row.key]
                return (
                  <tr key={row.key}>
                    <th
                      scope="row"
                      className="py-2.5 text-left font-medium text-foreground-secondary"
                    >
                      {row.label}
                    </th>
                    <td className="py-2.5 text-right text-foreground tabular-nums">
                      {formatNumber(final, row.digits)} {row.unit}
                      {isEdited(recommended, final) && (
                        <span className="ml-2 label-mono text-warning">Edited</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right text-muted-foreground tabular-nums">
                      {formatNumber(recommended, row.digits)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="label-mono text-muted-foreground">
              Workout template · {recommendation.capacity} days / week
              {templateEdited && <span className="ml-2 text-warning">Edited</span>}
            </p>
            {recommendation.sessions.length > 0 ? (
              <ol className="divide-y divide-border border-y border-border">
                {recommendation.sessions.map((session, index) => (
                  <li key={`${String(index)}-${session}`} className="flex gap-3 py-2 text-sm">
                    <span className="w-5 label-mono text-muted-foreground">{index + 1}</span>
                    <span className="text-foreground">{session}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No template in this recommendation.</p>
            )}
          </div>
          {recommendation.goal && (
            <div className="flex flex-col gap-1">
              <p className="label-mono text-muted-foreground">Focus for this cycle</p>
              <p className="text-sm text-foreground">
                {longTermGoalLabel(recommendation.goal.longTermGoal)}
                {recommendation.goal.focuses.length > 0 &&
                  ` · ${recommendation.goal.focuses.map(focusLabel).join(', ')}`}
              </p>
            </div>
          )}
          {recommendation.summary && (
            <p className="text-sm text-foreground-secondary">{recommendation.summary}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewForm({
  recommendation,
  onSave,
}: {
  recommendation: Recommendation
  onSave: (values: ReviewInput) => Promise<void>
}) {
  const [values, setValues] = useState<Record<keyof Targets, string>>({
    calories: String(recommendation.final.calories),
    proteinG: String(recommendation.final.proteinG),
    carbsG: String(recommendation.final.carbsG),
    fatG: String(recommendation.final.fatG),
    fiberG: String(recommendation.final.fiberG),
  })
  const [sessions, setSessions] = useState<string[]>(recommendation.sessions)
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = createReviewSchema(recommendation.sessions.length).safeParse({
      ...values,
      sessions,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        next[key] ??= issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await onSave(parsed.data)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <InlineAlert tone="warning" title="Recommended target">
        {REVIEW_WARNING}
      </InlineAlert>
      <div className="grid grid-cols-2 gap-4">
        {TARGET_ROWS.map((row) => (
          <FormField
            key={row.key}
            id={`review-${row.key}`}
            label={row.label}
            error={errors[row.key]}
            hint={`Recommended ${formatNumber(recommendation.recommended[row.key], row.digits)}`}
          >
            {(control) => (
              <AdornedInput
                {...control}
                trailing={row.unit.toUpperCase()}
                inputMode={row.digits === 0 ? 'numeric' : 'decimal'}
                autoComplete="off"
                value={values[row.key]}
                onChange={(event) => {
                  setValues((current) => ({ ...current, [row.key]: event.target.value }))
                }}
                disabled={saving}
              />
            )}
          </FormField>
        ))}
      </div>

      {sessions.length > 0 && (
        <fieldset className="flex flex-col gap-3" disabled={saving}>
          <legend className="mb-2 label-section text-foreground-secondary">
            Workout template <span className="text-muted-foreground normal-case">(names only)</span>
          </legend>
          {sessions.map((session, index) => (
            <FormField
              key={index}
              id={`review-session-${String(index)}`}
              label={`Session ${String(index + 1)}`}
              error={errors[`sessions.${String(index)}`]}
            >
              {(control) => (
                <Input
                  {...control}
                  maxLength={60}
                  value={session}
                  onChange={(event) => {
                    const next = event.target.value
                    setSessions((current) =>
                      current.map((value, i) => (i === index ? next : value)),
                    )
                  }}
                />
              )}
            </FormField>
          ))}
          <p className="text-xs text-muted-foreground">
            Workout capacity and goals are locked for this cycle.
          </p>
        </fieldset>
      )}

      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save targets'}
      </Button>
    </form>
  )
}

function AcceptConfirm({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-4">
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button
        size="lg"
        disabled={working}
        onClick={() => {
          setWorking(true)
          setError(null)
          onConfirm().catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : String(caught))
            setWorking(false)
          })
        }}
      >
        {working ? 'Locking…' : 'Accept & lock'}
      </Button>
    </div>
  )
}
