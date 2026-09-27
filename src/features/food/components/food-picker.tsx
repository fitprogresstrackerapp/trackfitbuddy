import { Plus, Search } from 'lucide-react'
import { useId, useState } from 'react'

import { InlineAlert } from '@/components/common/inline-alert'
import { Spinner } from '@/components/common/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { SegmentedControl } from '@/components/ui/tabs'

import { SEARCH_MIN_LENGTH, useFoodSearch, useFoodUsage } from '../api/food-queries'
import { formatQuantity, previewNutrition } from '../lib/food-logic'
import type { FoodOption } from '../types'
import { FoodSourceBadges, NutritionLine } from './food-labels'

interface FoodPickerProps {
  userId: string
  onSelect: (food: FoodOption) => void
  onCreate: (name: string) => void
}

type Suggestions = 'recent' | 'frequent'

/**
 * Select Food (spec §10). Empty query: ~10 quick suggestions (recent or
 * frequent). Typing: debounced server-side search, ranked exact → recent →
 * frequent → broader match.
 */
export function FoodPicker({ userId, onSelect, onCreate }: FoodPickerProps) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestions>('recent')
  const search = useFoodSearch(userId, query)
  const searching = query.trim().length >= SEARCH_MIN_LENGTH
  const usage = useFoodUsage(userId, suggestions, !searching)
  const listId = useId()

  const list = searching ? search : usage
  const foods = searching ? (search.active ? search.data : undefined) : usage.data
  const loading = searching
    ? search.pending || (search.isFetching && !search.data)
    : usage.isPending

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor="food-search" className="sr-only">
          Search foods
        </label>
        <Input
          id="food-search"
          type="search"
          autoComplete="off"
          placeholder="Search foods, e.g. chicken, idli, dal"
          className="pl-9"
          value={query}
          aria-controls={listId}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
        />
        {searching && search.isFetching && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2">
            <Spinner className="size-4" />
          </span>
        )}
      </div>

      {!searching && (
        <div className="flex items-center justify-between gap-3">
          <SegmentedControl
            label="Suggestions"
            value={suggestions}
            onValueChange={setSuggestions}
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'frequent', label: 'Frequent' },
            ]}
          />
          {query.trim().length > 0 && (
            <span className="label-mono text-muted-foreground">
              Type {SEARCH_MIN_LENGTH}+ letters
            </span>
          )}
        </div>
      )}

      <div id={listId} aria-busy={loading || undefined}>
        {list.isError ? (
          <InlineAlert title="Foods couldn’t be loaded">
            <span className="flex flex-wrap items-center gap-3">
              Check your connection.
              <Button variant="link" onClick={() => void list.refetch()}>
                Retry
              </Button>
            </span>
          </InlineAlert>
        ) : loading && !foods ? (
          <FoodListSkeleton />
        ) : foods && foods.length > 0 ? (
          <>
            <p className="sr-only" aria-live="polite">
              {searching
                ? `${String(foods.length)} ${foods.length === 1 ? 'food' : 'foods'} found`
                : ''}
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {foods.map((food) => (
                <li key={`${food.source}-${food.id}`}>
                  <FoodResult
                    food={food}
                    onSelect={() => {
                      onSelect(food)
                    }}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : searching ? (
          <p className="text-sm text-foreground-secondary" aria-live="polite">
            No foods match “{query.trim()}”.
          </p>
        ) : (
          <p className="text-sm text-foreground-secondary">
            {suggestions === 'recent'
              ? 'Foods you log will appear here. Search the food database to start.'
              : 'Your most-logged foods will appear here.'}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-secondary">
        Can’t find it?
        <Button
          variant="link"
          onClick={() => {
            onCreate(query.trim())
          }}
        >
          <Plus aria-hidden="true" />
          Create a food
        </Button>
      </div>
    </div>
  )
}

function FoodResult({ food, onSelect }: { food: FoodOption; onSelect: () => void }) {
  const perServing = previewNutrition(food, food.servingQuantity)
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full cursor-pointer flex-col gap-1.5 px-3 py-3 text-left transition-colors outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium break-words text-foreground">{food.name}</span>
        <span className="label-mono text-muted-foreground">
          {formatQuantity(food.servingQuantity, food.servingUnit)}
        </span>
        <FoodSourceBadges food={food} className="ml-auto" />
      </span>
      {perServing && <NutritionLine values={perServing} approximate={food.isApproximate} />}
    </button>
  )
}

function FoodListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  )
}
