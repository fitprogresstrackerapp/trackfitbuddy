import { Copy, Lock, Plus } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { InlineAlert } from '@/components/common/inline-alert'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'
import { useAccount } from '@/features/auth/auth-context'
import {
  NutritionSummary,
  NutritionSummarySkeleton,
} from '@/features/nutrition/components/nutrition-summary'
import { sumNutrition } from '@/features/nutrition/lib/nutrition'
import { formatDayLabel, safeTimeZone, todayInTimeZone } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'

import { useDayMeals, useDayTargets, useFoodMutations, useMySubmissions } from '../api/food-queries'
import { AddFoodSheet, type AddStart, type SaveMealInput } from '../components/add-food-sheet'
import { CopyMealSheet } from '../components/copy-meal-sheet'
import { DayNav } from '@/components/common/day-nav'
import {
  CategoryDialog,
  ConfirmDeleteMealDialog,
  EditQuantityDialog,
} from '../components/meal-dialogs'
import { MealList } from '../components/meal-list'
import { MyFoods } from '../components/my-foods'
import { QuickAdd } from '../components/quick-add'
import {
  dayKind,
  friendlyError,
  LATE_ENTRY_DAYS,
  mealLabel,
  resolveDateParam,
} from '../lib/food-logic'
import type { LoggedItem, LoggedMeal } from '../types'

/** Runs a mutation and turns any failure into a user-facing message. */
async function friendly<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new Error(friendlyError(error, fallback), { cause: error })
  }
}

function pastDayMessage(hasMeals: boolean, lateEntry: boolean): string {
  if (!lateEntry) {
    return `This day is read-only. Missing food can be added for the last ${String(LATE_ENTRY_DAYS)} days.`
  }
  return hasMeals
    ? 'You can view existing entries. A meal you missed can still be added; it locks once saved.'
    : 'You can add missing food for this day. Once added, historical entries are locked.'
}

/**
 * Food (spec §10–13): the selected day's intake against its targets, the
 * day's meals, and logging. "Today" is the calendar day in the profile
 * timezone — the day the database uses for locking. Past days are read-only
 * except for adding a missing meal (late entry), which locks once saved.
 */
export function FoodPage() {
  const { profile } = useAccount()
  const timeZone = safeTimeZone(profile.timezone)
  const today = todayInTimeZone(timeZone)
  const [params, setParams] = useSearchParams()
  const { date, valid } = resolveDateParam(params.get('date'), today)
  const day = dayKind(date, today)
  const canAdd = day.kind === 'today' || (day.kind === 'past' && day.lateEntry)
  const dayLabel = date === today ? 'today' : formatDayLabel(date)

  const meals = useDayMeals(profile.id, date)
  const targets = useDayTargets(profile.id, date)
  const submissions = useMySubmissions(profile.id)
  const mutations = useFoodMutations(profile.id)

  const [addOpen, setAddOpen] = useState(false)
  const [targetMeal, setTargetMeal] = useState<LoggedMeal | null>(null)
  const [addStart, setAddStart] = useState<AddStart>({ kind: 'pick' })
  const [copyOpen, setCopyOpen] = useState(false)
  const [editing, setEditing] = useState<LoggedItem | null>(null)
  const [deletingMeal, setDeletingMeal] = useState<LoggedMeal | null>(null)
  const [categoryMeal, setCategoryMeal] = useState<LoggedMeal | null>(null)
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())

  // ?add=meal (Home quick action) opens the add flow; closing it clears the
  // parameter. An invalid or future ?date= shows today with a notice until
  // the user picks another day.
  const addFromLink = params.get('add') === 'meal' && canAdd
  const addSheetOpen = addOpen || addFromLink
  const dateNotice = !valid

  function closeAdd() {
    setAddOpen(false)
    setTargetMeal(null)
    setAddStart({ kind: 'pick' })
    if (params.has('add')) {
      setParams(
        (current) => {
          current.delete('add')
          return current
        },
        { replace: true },
      )
    }
  }

  function goTo(next: string) {
    setParams((current) => {
      if (next === today) current.delete('date')
      else current.set('date', next)
      current.delete('add')
      return current
    })
  }

  function markBusy(id: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function openAdd(meal: LoggedMeal | null, start: AddStart = { kind: 'pick' }) {
    setTargetMeal(meal)
    setAddStart(start)
    setAddOpen(true)
  }

  async function saveMeal(input: SaveMealInput) {
    await friendly(
      () => mutations.saveMeal.mutateAsync({ ...input, date }),
      'Couldn’t save this food. Please try again.',
    )
    closeAdd()
    const count = input.items.length
    notify.success(
      input.existingMealId ? 'Food added' : date < today ? 'Missing meal saved' : 'Meal saved',
      `${String(count)} ${count === 1 ? 'food' : 'foods'} logged for ${dayLabel}.`,
    )
  }

  async function copyInto(meal: LoggedMeal, target: string) {
    await friendly(
      () => mutations.duplicateMeal.mutateAsync({ mealId: meal.id, date: target }),
      'Couldn’t copy this meal. Please try again.',
    )
    notify.success(
      'Meal copied',
      `${mealLabel(meal)} added to ${target === today ? 'today' : formatDayLabel(target)} as a new meal.`,
    )
  }

  function removeItem(meal: LoggedMeal, item: LoggedItem) {
    // Removing the last food removes the meal: confirm like any meal deletion.
    if (meal.meal_items.length <= 1) {
      setDeletingMeal(meal)
      return
    }
    markBusy(item.id, true)
    friendly(
      () => mutations.removeItem.mutateAsync(item.id),
      'Couldn’t remove this food. Please try again.',
    )
      .then(() => {
        notify.success('Food removed', `${item.foodName} removed from ${mealLabel(meal)}.`)
      })
      .catch((error: unknown) => {
        notify.error('Couldn’t remove food', error instanceof Error ? error.message : undefined)
      })
      .finally(() => {
        markBusy(item.id, false)
      })
  }

  const totals = meals.data ? sumNutrition(meals.data) : null
  const mealCount = meals.data?.length ?? 0
  const hasMeals = mealCount > 0

  return (
    <Page>
      <PageHeader
        eyebrow={date === today ? `Today · ${formatDayLabel(date)}` : formatDayLabel(date)}
        title="Food"
        actions={
          canAdd ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setCopyOpen(true)
                }}
              >
                <Copy aria-hidden="true" />
                Copy meal
              </Button>
              <Button
                onClick={() => {
                  openAdd(null)
                }}
              >
                <Plus aria-hidden="true" />
                {day.kind === 'past' ? 'Add missing meal' : 'Add food'}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <DayNav date={date} today={today} onChange={goTo} />
        {dateNotice && (
          <InlineAlert tone="info" title="Showing today">
            That date isn’t available — food can’t be logged for future dates.
          </InlineAlert>
        )}
        {day.kind === 'past' && (
          <InlineAlert
            tone="info"
            icon={Lock}
            title={hasMeals ? 'Food history is locked' : 'Past day'}
          >
            {pastDayMessage(hasMeals, day.lateEntry)}
          </InlineAlert>
        )}
      </div>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Section
          title={date === today ? 'Today’s nutrition' : 'Nutrition'}
          meta={formatDayLabel(date)}
        >
          {meals.isPending || targets.isPending ? (
            <NutritionSummarySkeleton />
          ) : meals.isError ? (
            <ErrorState
              title="Nutrition couldn’t be loaded"
              description="Check your connection and try again."
              action={
                <Button variant="secondary" onClick={() => void meals.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : (
            <NutritionSummary
              totals={totals}
              targets={targets.data ?? null}
              targetsState={targets.isError ? 'error' : 'ready'}
              onRetryTargets={() => void targets.refetch()}
              emptyText={date === today ? 'No meals logged today' : 'No meals logged on this day'}
              past={date < today}
            />
          )}
        </Section>
        {canAdd && (
          <QuickAdd
            className="hidden xl:flex"
            userId={profile.id}
            onSearch={() => {
              openAdd(null)
            }}
            onPick={(food) => {
              openAdd(null, { kind: 'quantity', food })
            }}
            onCreate={() => {
              openAdd(null, { kind: 'create' })
            }}
          />
        )}
      </div>

      <Section
        title="Meals"
        meta={meals.data ? `${String(mealCount)} ${mealCount === 1 ? 'meal' : 'meals'}` : undefined}
      >
        {meals.isPending ? (
          <div className="flex flex-col gap-4" aria-hidden="true">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : meals.isError ? (
          <ErrorState
            title="Meals couldn’t be loaded"
            description="Check your connection and try again."
            action={
              <Button variant="secondary" onClick={() => void meals.refetch()}>
                Retry
              </Button>
            }
          />
        ) : meals.data.length === 0 ? (
          <EmptyState
            icon={ICONS.food}
            title={day.kind === 'today' ? 'No meals logged' : 'No food logged'}
            description={
              day.kind === 'today'
                ? 'Log what you eat to see today against your targets.'
                : 'Nothing was logged on this day.'
            }
            {...(canAdd
              ? {
                  action: (
                    <Button
                      onClick={() => {
                        openAdd(null)
                      }}
                    >
                      <Plus aria-hidden="true" />
                      {day.kind === 'past' ? 'Add missing meal' : 'Add food'}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <MealList
            meals={meals.data}
            today={today}
            busyIds={busyIds}
            onAddFood={openAdd}
            onEditItem={(_meal, item) => {
              setEditing(item)
            }}
            onDeleteItem={removeItem}
            onDeleteMeal={setDeletingMeal}
            onChangeCategory={setCategoryMeal}
            onCopy={(meal) => {
              markBusy(meal.id, true)
              copyInto(meal, today)
                .catch((error: unknown) => {
                  notify.error(
                    'Couldn’t copy meal',
                    error instanceof Error ? error.message : undefined,
                  )
                })
                .finally(() => {
                  markBusy(meal.id, false)
                })
            }}
          />
        )}
      </Section>

      {submissions.data && <MyFoods submissions={submissions.data} />}

      <AddFoodSheet
        open={addSheetOpen}
        onOpenChange={(open) => {
          if (open) setAddOpen(true)
          else closeAdd()
        }}
        userId={profile.id}
        date={date}
        today={today}
        meals={meals.data ?? []}
        targetMeal={targetMeal}
        start={addStart}
        onSave={saveMeal}
        onCreateFood={(input) =>
          friendly(
            () => mutations.createFood.mutateAsync(input),
            'Couldn’t submit this food. Please try again.',
          )
        }
      />
      <CopyMealSheet
        open={copyOpen}
        onOpenChange={setCopyOpen}
        userId={profile.id}
        date={date}
        today={today}
        onCopy={async (meal) => {
          await copyInto(meal, date)
          setCopyOpen(false)
        }}
      />
      <EditQuantityDialog
        item={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSave={async (quantity) => {
          if (!editing) return
          await friendly(
            () => mutations.changeQuantity.mutateAsync({ itemId: editing.id, quantity }),
            'Couldn’t update the quantity. Please try again.',
          )
          notify.success('Quantity updated', editing.foodName)
          setEditing(null)
        }}
      />
      <ConfirmDeleteMealDialog
        meal={deletingMeal}
        dayLabel={dayLabel}
        onOpenChange={(open) => {
          if (!open) setDeletingMeal(null)
        }}
        onConfirm={async () => {
          if (!deletingMeal) return
          await friendly(
            () => mutations.removeMeal.mutateAsync(deletingMeal.id),
            'Couldn’t delete this meal. Please try again.',
          )
          notify.success('Meal deleted', `${mealLabel(deletingMeal)} removed from ${dayLabel}.`)
          setDeletingMeal(null)
        }}
      />
      <CategoryDialog
        meal={categoryMeal}
        onOpenChange={(open) => {
          if (!open) setCategoryMeal(null)
        }}
        onSave={async (category) => {
          if (!categoryMeal) return
          await friendly(
            () => mutations.changeCategory.mutateAsync({ mealId: categoryMeal.id, category }),
            'Couldn’t change the category. Please try again.',
          )
          setCategoryMeal(null)
        }}
      />
    </Page>
  )
}
