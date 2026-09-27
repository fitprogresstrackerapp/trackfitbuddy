import { Lock } from 'lucide-react'
import { useState } from 'react'

import { InlineAlert } from '@/components/common/inline-alert'
import { StatusBadge } from '@/components/data/status-badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDayLabel, formatShortDate } from '@/lib/dates/local-date'

import { useCopyCandidates } from '../api/food-queries'
import { mealLabel, mealTotals } from '../lib/food-logic'
import type { LoggedMeal } from '../types'
import { NutritionLine } from './food-labels'

interface CopyMealSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  /** The day the copy is created on (today, or a past day as late entry). */
  date: string
  today: string
  onCopy: (meal: LoggedMeal) => Promise<void>
}

/**
 * Copy previous meal (spec §10): the copy is a new, independent meal; the
 * original — locked or not — is never changed.
 */
export function CopyMealSheet({
  open,
  onOpenChange,
  userId,
  date,
  today,
  onCopy,
}: CopyMealSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {open && (
        <SheetContent>
          <CopyMealList userId={userId} date={date} today={today} onCopy={onCopy} />
        </SheetContent>
      )}
    </Sheet>
  )
}

function CopyMealList({
  userId,
  date,
  today,
  onCopy,
}: Omit<CopyMealSheetProps, 'open' | 'onOpenChange'>) {
  const candidates = useCopyCandidates(userId, date, true)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isPast = date < today

  return (
    <>
      <SheetHeader
        eyebrow={formatDayLabel(date)}
        title="Copy a meal"
        description={`The copy becomes a new meal on ${date === today ? 'today' : formatDayLabel(date)}. The original stays unchanged.`}
      />
      {isPast && (
        <InlineAlert tone="warning" icon={Lock} title="Locked once saved">
          Copying into a past day adds a missing meal that can’t be edited afterwards.
        </InlineAlert>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}

      {candidates.isPending ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : candidates.isError ? (
        <InlineAlert title="Meals couldn’t be loaded">
          <span className="flex flex-wrap items-center gap-3">
            Check your connection.
            <Button variant="link" onClick={() => void candidates.refetch()}>
              Retry
            </Button>
          </span>
        </InlineAlert>
      ) : candidates.data.length === 0 ? (
        <p className="text-sm text-foreground-secondary">
          No meals in the last 14 days to copy from.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {candidates.data.map((meal) => (
            <li key={meal.id} className="flex items-start gap-3 px-3 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="label-mono text-muted-foreground">
                    {meal.date === today ? 'Today' : formatShortDate(meal.date)}
                  </span>
                  <span className="text-sm font-medium text-foreground">{mealLabel(meal)}</span>
                  {meal.isLocked && <StatusBadge status="locked" />}
                </div>
                <p className="line-clamp-2 text-sm text-foreground-secondary">
                  {meal.meal_items.map((item) => item.foodName).join(', ')}
                </p>
                <NutritionLine values={mealTotals(meal)} />
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={copyingId !== null}
                aria-label={`Copy ${mealLabel(meal)} from ${formatShortDate(meal.date)}`}
                onClick={() => {
                  setCopyingId(meal.id)
                  setError(null)
                  onCopy(meal)
                    .catch((caught: unknown) => {
                      setError(caught instanceof Error ? caught.message : String(caught))
                    })
                    .finally(() => {
                      setCopyingId(null)
                    })
                }}
              >
                {copyingId === meal.id ? 'Copying…' : 'Copy'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
