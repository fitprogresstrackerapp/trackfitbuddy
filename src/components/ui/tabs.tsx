import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

/** Underlined tab strip — for switching views within a page. */
function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex gap-5 overflow-x-auto border-b border-border', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px shrink-0 cursor-pointer border-b-2 border-transparent pt-1 pb-2.5 label-section text-muted-foreground transition-colors outline-none hover:text-foreground-secondary focus-visible:text-foreground focus-visible:underline focus-visible:underline-offset-4 disabled:pointer-events-none disabled:opacity-45 data-[state=active]:border-primary data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('pt-5 outline-none', className)}
      {...props}
    />
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  /** Accessible name of the group, e.g. "Time range". */
  label: string
  className?: string
}

/** Exactly-one-of choice, e.g. 7D · 30D · 3M · 6M · 1Y. */
function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next)
        if (option) onValueChange(option.value) // ignore deselection
      }}
      className={cn(
        'inline-flex h-8 items-stretch rounded-sm border border-border bg-surface-1 p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="cursor-pointer rounded-xs px-2.5 label-mono text-muted-foreground transition-colors outline-none hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-surface-2 data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}

interface FilterControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T[]
  onValueChange: (value: T[]) => void
  label: string
  className?: string
}

/** Any-of filter chips, e.g. BREAKFAST · LUNCH · DINNER · SNACKS. Empty = all. */
function FilterControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  className,
}: FilterControlProps<T>) {
  return (
    <ToggleGroupPrimitive.Root
      type="multiple"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        onValueChange(options.filter((option) => next.includes(option.value)).map((o) => o.value))
      }}
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="h-7 cursor-pointer rounded-xs border border-border px-2.5 label-mono text-muted-foreground transition-colors outline-none hover:border-foreground-secondary/40 hover:text-foreground-secondary focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:border-primary/60 data-[state=on]:bg-primary-surface data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}

export { FilterControl, SegmentedControl, Tabs, TabsContent, TabsList, TabsTrigger }
export type { SegmentedOption }
