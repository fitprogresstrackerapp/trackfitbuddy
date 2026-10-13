import { Plus, Utensils } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { EmptyState } from '@/components/common/empty-state'
import { FormField } from '@/components/common/form-field'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge } from '@/components/data/status-badge'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { notify } from '@/lib/feedback'
import { formatNumber } from '@/lib/format'

import {
  FOODS_PAGE_SIZE,
  type FoodAdminRow,
  type FoodAdminStatus,
  type FoodFilters,
  type FoodSort,
  type FoodSource,
} from '../api/food-admin-data'
import { useFoodAdminMutations, useFoodList } from '../api/food-admin-queries'
import { ConfirmDialog, Pagination } from '../components/admin-ui'
import { FoodSheet, type FoodSheetTarget } from '../components/food-forms'
import {
  FOOD_SORT_LABELS,
  FOOD_SOURCE_LABELS,
  FOOD_STATUS_LABELS,
  formatDay,
  isFoodStatus,
  servingBasis,
  sourceLabel,
} from '../lib/food-admin-logic'

const ANY = 'ANY'

/**
 * Food Database (spec §11, §78): the shared catalogue and the review queue of
 * user-created foods, in one server-side list. Search, filters, sorting and
 * pagination happen in the database; only one page of rows is ever loaded.
 * Every value shown is the stored value, for the serving named beside it.
 */
export function AdminFoodPage() {
  const [params, setParams] = useSearchParams()
  const statusParam = params.get('status')
  const status: FoodAdminStatus | null = isFoodStatus(statusParam) ? statusParam : null
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [source, setSource] = useState<string>(ANY)
  const [sort, setSort] = useState<FoodSort>('NAME')
  const [page, setPage] = useState(0)
  const [sheet, setSheet] = useState<FoodSheetTarget | null>(null)
  const [toggling, setToggling] = useState<FoodAdminRow | null>(null)
  const { setActive } = useFoodAdminMutations()

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search)
      setPage(0)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [search])

  const filters: FoodFilters = {
    search: debounced,
    status,
    source: source === ANY ? null : (source as FoodSource),
    sort,
  }
  const foods = useFoodList(filters, page)
  // The review queue's size, independent of the filters in use.
  const pending = useFoodList(
    { search: '', status: 'PENDING_REVIEW', source: null, sort: 'NAME' },
    0,
  )
  const pendingCount = pending.data?.total ?? 0

  const setStatus = (value: string) => {
    setPage(0)
    setParams(value === ANY ? {} : { status: value }, { replace: true })
  }
  const addFood = (
    <Button
      onClick={() => {
        setSheet({ mode: 'create' })
      }}
    >
      <Plus aria-hidden="true" />
      Add food
    </Button>
  )
  const open = (food: FoodAdminRow) => {
    setSheet(food.kind === 'FOOD' ? { mode: 'edit', food } : { mode: 'review', food })
  }
  const isQueue = status === 'PENDING_REVIEW'
  const filtered = debounced.trim() !== '' || status !== null || source !== ANY

  return (
    <Page>
      <Breadcrumb items={[{ label: 'Admin', to: ROUTES.admin }, { label: 'Food Database' }]} />
      <PageHeader
        eyebrow="Control"
        title="Food Database"
        description="The shared food catalogue every user searches, and foods created by users that are waiting for review."
        actions={addFood}
      />

      {pendingCount > 0 && !isQueue && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border px-4 py-3">
          <StatusBadge status="pending" label="Pending review" />
          <span className="text-sm text-foreground">
            {formatNumber(pendingCount)} {pendingCount === 1 ? 'food is' : 'foods are'} awaiting
            review.
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setStatus('PENDING_REVIEW')
            }}
          >
            Review
          </Button>
        </div>
      )}

      <Section title="Find foods">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FormField id="food-search" label="Food name">
            {(control) => (
              <Input
                {...control}
                type="search"
                autoComplete="off"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
              />
            )}
          </FormField>
          <FilterSelect
            id="food-status"
            label="Status"
            value={status ?? ANY}
            onChange={setStatus}
            options={[
              { value: ANY, label: 'All' },
              ...Object.entries(FOOD_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            id="food-source"
            label="Source"
            value={source}
            onChange={(value) => {
              setSource(value)
              setPage(0)
            }}
            options={[
              { value: ANY, label: 'Any source' },
              ...Object.entries(FOOD_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <FilterSelect
            id="food-sort"
            label="Sort by"
            value={sort}
            onChange={(value) => {
              setSort(value as FoodSort)
              setPage(0)
            }}
            options={Object.entries(FOOD_SORT_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </Section>

      <Section
        title={isQueue ? 'Awaiting review' : 'Foods'}
        meta={
          foods.isPlaceholderData
            ? 'Updating…'
            : foods.data
              ? `${formatNumber(foods.data.total)} found`
              : undefined
        }
      >
        {foods.isError ? (
          <SectionError title="Foods unavailable" onRetry={() => void foods.refetch()} />
        ) : foods.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : foods.data.rows.length === 0 ? (
          isQueue ? (
            <EmptyState icon={Utensils} title="No foods awaiting review." />
          ) : (
            <EmptyState
              icon={Utensils}
              title="No shared foods found."
              {...(filtered ? { description: 'Try a different search or filter.' } : {})}
              action={addFood}
            />
          )
        ) : (
          <div
            aria-busy={foods.isPlaceholderData || undefined}
            className="flex flex-col gap-5 transition-opacity aria-busy:opacity-60"
          >
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Foods. Nutrition values are for the serving shown in each row.
                </caption>
                <thead>
                  <tr className="label-mono text-muted-foreground">
                    <th scope="col" className="pb-2 text-left font-normal">
                      Food
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Serving
                    </th>
                    {['Kcal', 'Protein', 'Carbs', 'Fat', 'Fiber'].map((label) => (
                      <th key={label} scope="col" className="pb-2 pl-3 text-right font-normal">
                        {label}
                      </th>
                    ))}
                    <th scope="col" className="pb-2 pl-4 text-left font-normal">
                      Source
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Status
                    </th>
                    <th scope="col" className="pb-2 text-left font-normal">
                      Updated
                    </th>
                    <th scope="col" className="pb-2 text-right font-normal">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border border-t border-border">
                  {foods.data.rows.map((food) => (
                    <tr key={`${food.kind}-${food.id}`} className="hover:bg-surface-1">
                      <td className="max-w-64 py-2.5 pr-3">
                        <span className="font-medium break-words text-foreground">{food.name}</span>
                        {food.isApproximate && food.kind === 'FOOD' && (
                          <span className="ml-2 label-mono whitespace-nowrap text-muted-foreground">
                            ≈ Est.
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {servingBasis(food)}
                      </td>
                      {[food.calories, food.proteinG, food.carbsG, food.fatG, food.fiberG].map(
                        (value, index) => (
                          <td
                            key={index}
                            className="py-2.5 pl-3 text-right text-foreground-secondary tabular-nums"
                          >
                            {formatNumber(value, 1)}
                            {index > 0 ? ' g' : ''}
                          </td>
                        ),
                      )}
                      <td className="py-2.5 pr-3 pl-4 text-foreground-secondary">
                        {sourceLabel(food)}
                        {food.submittedByName && (
                          <span className="block text-xs text-muted-foreground">
                            {food.submittedByName}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <FoodStatusBadge status={food.status} />
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-foreground-secondary">
                        {formatDay(food.updatedAt)}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <RowActions food={food} onOpen={open} onToggle={setToggling} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border border-y border-border lg:hidden">
              {foods.data.rows.map((food) => (
                <li key={`${food.kind}-${food.id}`} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-medium break-words text-foreground">
                      {food.name}
                    </span>
                    <FoodStatusBadge status={food.status} />
                  </div>
                  <span className="label-mono text-muted-foreground">
                    {servingBasis(food)} · {formatNumber(food.calories, 1)} kcal · P{' '}
                    {formatNumber(food.proteinG, 1)} · C {formatNumber(food.carbsG, 1)} · F{' '}
                    {formatNumber(food.fatG, 1)} · Fi {formatNumber(food.fiberG, 1)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {sourceLabel(food)}
                    {food.submittedByName ? ` · ${food.submittedByName}` : ''} · Updated{' '}
                    {formatDay(food.updatedAt)}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <RowActions food={food} onOpen={open} onToggle={setToggling} />
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={FOODS_PAGE_SIZE}
              total={foods.data.total}
              onPage={setPage}
            />
          </div>
        )}
      </Section>

      <FoodSheet
        target={sheet}
        onClose={() => {
          setSheet(null)
        }}
      />

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(next) => {
          if (!next) setToggling(null)
        }}
        eyebrow="Food database"
        title={
          toggling?.status === 'INACTIVE'
            ? `Activate ${toggling.name}?`
            : `Deactivate ${toggling?.name ?? 'food'}?`
        }
        description={
          toggling?.status === 'INACTIVE'
            ? 'Users will be able to find and log this food again.'
            : 'Users will no longer find or log this food. Meals already logged with it are kept unchanged. Nothing is deleted.'
        }
        confirmLabel={toggling?.status === 'INACTIVE' ? 'Activate' : 'Deactivate'}
        onConfirm={async (reason) => {
          if (!toggling) return
          const active = toggling.status === 'INACTIVE'
          await setActive.mutateAsync({
            id: toggling.id,
            version: toggling.updatedAt,
            active,
            reason,
          })
          notify.success(
            active ? 'Food activated' : 'Food deactivated',
            'Recorded in the audit log.',
          )
        }}
      />
    </Page>
  )
}

function FoodStatusBadge({ status }: { status: FoodAdminStatus }) {
  if (status === 'ACTIVE') return <StatusBadge status="active" />
  if (status === 'INACTIVE') return <StatusBadge status="locked" label="Inactive" />
  if (status === 'REJECTED') return <StatusBadge status="failed" label="Rejected" />
  return <StatusBadge status="pending" label="Pending review" />
}

function RowActions({
  food,
  onOpen,
  onToggle,
}: {
  food: FoodAdminRow
  onOpen: (food: FoodAdminRow) => void
  onToggle: (food: FoodAdminRow) => void
}) {
  if (food.kind === 'SUBMISSION') {
    const pending = food.status === 'PENDING_REVIEW'
    return (
      <Button
        variant={pending ? 'secondary' : 'ghost'}
        size="sm"
        aria-label={`${pending ? 'Review' : 'View'} ${food.name}`}
        onClick={() => {
          onOpen(food)
        }}
      >
        {pending ? 'Review' : 'View'}
      </Button>
    )
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Edit ${food.name}`}
        onClick={() => {
          onOpen(food)
        }}
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`${food.status === 'INACTIVE' ? 'Activate' : 'Deactivate'} ${food.name}`}
        onClick={() => {
          onToggle(food)
        }}
      >
        {food.status === 'INACTIVE' ? 'Activate' : 'Deactivate'}
      </Button>
    </>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <FormField id={id} label={label}>
      {(control) => (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger {...control}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </FormField>
  )
}
