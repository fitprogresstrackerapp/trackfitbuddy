import { Plus, Search } from 'lucide-react'
import { useState } from 'react'

import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SegmentedControl } from '@/components/ui/tabs'
import { formatNumber } from '@/lib/format'

import { useFoodUsage } from '../api/food-queries'
import { formatQuantity } from '../lib/food-logic'
import type { FoodOption } from '../types'

interface QuickAddProps {
  userId: string
  onSearch: () => void
  onPick: (food: FoodOption) => void
  onCreate: () => void
  className?: string
}

const QUICK_COUNT = 6

/**
 * Desktop quick add (spec §10: recent and frequent first). One click on a
 * food goes straight to its quantity; search opens the full add flow.
 */
export function QuickAdd({ userId, onSearch, onPick, onCreate, className }: QuickAddProps) {
  const [order, setOrder] = useState<'recent' | 'frequent'>('recent')
  const usage = useFoodUsage(userId, order)
  const foods = usage.data?.slice(0, QUICK_COUNT)

  return (
    <Section title="Quick add" className={className}>
      <button
        type="button"
        onClick={onSearch}
        className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm border border-input bg-surface-1 px-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:border-foreground-secondary/30 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25"
      >
        <Search aria-hidden="true" className="size-4" />
        Search foods
      </button>

      <div>
        <SegmentedControl
          label="Suggestions"
          value={order}
          onValueChange={setOrder}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'frequent', label: 'Frequent' },
          ]}
        />
      </div>

      {usage.isPending ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : usage.isError ? (
        <p className="text-sm text-foreground-secondary">
          Suggestions couldn’t be loaded.{' '}
          <Button variant="link" onClick={() => void usage.refetch()}>
            Retry
          </Button>
        </p>
      ) : foods && foods.length > 0 ? (
        <ul className="divide-y divide-border border-y border-border">
          {foods.map((food) => (
            <li key={`${food.source}-${food.id}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(food)
                }}
                className="flex w-full cursor-pointer items-baseline gap-3 px-1 py-2.5 text-left transition-colors outline-none hover:bg-surface-1 focus-visible:bg-surface-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{food.name}</span>
                <span className="shrink-0 label-mono text-muted-foreground">
                  {formatQuantity(food.servingQuantity, food.servingUnit)} ·{' '}
                  {food.isApproximate ? '≈ ' : ''}
                  {formatNumber(food.calories)} kcal
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {order === 'recent'
            ? 'Foods you log will appear here.'
            : 'Your most-logged foods will appear here.'}
        </p>
      )}

      <div>
        <Button variant="link" onClick={onCreate}>
          <Plus aria-hidden="true" />
          Create a food
        </Button>
      </div>
    </Section>
  )
}
