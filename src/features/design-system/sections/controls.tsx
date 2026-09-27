import { Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { AdornedInput } from '@/components/common/adorned-input'
import { FormField } from '@/components/common/form-field'
import { Section } from '@/components/layout/page'
import { Button, IconButton } from '@/components/ui/button'
import { Checkbox, RadioGroup, RadioGroupItem, Toggle } from '@/components/ui/choice'
import { DatePicker, Input, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FilterControl,
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

const RANGES = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
] as const

const MEALS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snacks', label: 'Snacks' },
] as const

export function ButtonsSection() {
  return (
    <Section title="Buttons" meta="primary · secondary · ghost · destructive">
      <div className="flex flex-wrap items-center gap-3">
        <Button>
          <Plus aria-hidden="true" />
          Add food
        </Button>
        <Button variant="secondary">Copy meal</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        <Button variant="link">View history</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Search foods" icon={Search} variant="secondary" />
        <IconButton label="Filters" icon={SlidersHorizontal} />
        <IconButton label="Remove item" icon={Trash2} size="sm" variant="destructive" />
      </div>
    </Section>
  )
}

export function FormsSection() {
  const [meal, setMeal] = useState('')
  const [notify, setNotify] = useState(true)
  return (
    <Section title="Forms" meta="labels · helper · error · disabled">
      <div className="grid gap-6 md:grid-cols-2">
        <FormField id="ds-name" label="Food name" hint="As it appears on the menu">
          {(control) => <Input {...control} placeholder="Chicken breast" />}
        </FormField>
        <FormField id="ds-qty" label="Quantity" error="Enter a quantity greater than 0">
          {(control) => (
            <AdornedInput {...control} trailing="G" inputMode="decimal" defaultValue="0" />
          )}
        </FormField>
        <FormField id="ds-meal" label="Meal category" hint="Optional">
          {(control) => (
            <Select value={meal} onValueChange={setMeal}>
              <SelectTrigger {...control}>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {MEALS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField id="ds-date" label="Date">
          {(control) => <DatePicker {...control} defaultValue="2026-09-21" />}
        </FormField>
        <FormField id="ds-feedback" label="Monthly feedback" className="md:col-span-2">
          {(control) => (
            <Textarea {...control} placeholder="The current split is difficult to follow…" />
          )}
        </FormField>
        <FormField id="ds-disabled" label="Locked value" hint="Locked records cannot be edited">
          {(control) => <Input {...control} disabled defaultValue="1,450 kcal" />}
        </FormField>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <div className="flex items-center gap-2.5">
          <Checkbox id="ds-approx" defaultChecked />
          <Label
            htmlFor="ds-approx"
            className="text-sm font-normal tracking-normal text-foreground normal-case"
          >
            Values are approximate
          </Label>
        </div>
        <RadioGroup defaultValue="manual" aria-label="Weight source">
          {(['manual', 'inbody'] as const).map((value) => (
            <div key={value} className="flex items-center gap-2.5">
              <RadioGroupItem id={`ds-source-${value}`} value={value} />
              <Label
                htmlFor={`ds-source-${value}`}
                className="text-sm font-normal tracking-normal text-foreground normal-case"
              >
                {value === 'manual' ? 'Manual' : 'InBody'}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <div className="flex items-center gap-2.5">
          <Toggle id="ds-toggle" checked={notify} onCheckedChange={setNotify} />
          <Label
            htmlFor="ds-toggle"
            className="text-sm font-normal tracking-normal text-foreground normal-case"
          >
            Show estimated calories
          </Label>
        </div>
      </div>
    </Section>
  )
}

export function SelectionSection() {
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d')
  const [meals, setMeals] = useState<(typeof MEALS)[number]['value'][]>(['lunch'])
  return (
    <Section title="Tabs · segmented · filters" meta={range.toUpperCase()}>
      <div className="flex flex-wrap items-center gap-4">
        <SegmentedControl
          label="Time range"
          options={RANGES}
          value={range}
          onValueChange={setRange}
        />
        <FilterControl
          label="Meal category"
          options={MEALS}
          value={meals}
          onValueChange={setMeals}
        />
      </div>
      <Tabs defaultValue="body">
        <TabsList>
          <TabsTrigger value="body">Body</TabsTrigger>
          <TabsTrigger value="nutrition">Nutrition</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          <TabsTrigger value="steps">Steps</TabsTrigger>
        </TabsList>
        <TabsContent value="body">
          <p className="text-sm text-foreground-secondary">
            Weight trend, body fat and muscle mass.
          </p>
        </TabsContent>
        <TabsContent value="nutrition">
          <p className="text-sm text-foreground-secondary">Calories and macros against target.</p>
        </TabsContent>
        <TabsContent value="training">
          <p className="text-sm text-foreground-secondary">Weekly completion, Monday–Sunday.</p>
        </TabsContent>
        <TabsContent value="steps">
          <p className="text-sm text-foreground-secondary">Step trend and daily average.</p>
        </TabsContent>
      </Tabs>
    </Section>
  )
}
