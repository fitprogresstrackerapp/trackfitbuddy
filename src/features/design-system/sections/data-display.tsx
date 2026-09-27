import { Lock, Plus } from 'lucide-react'

import { EmptyState } from '@/components/common/empty-state'
import { ErrorState } from '@/components/common/error-state'
import { InlineAlert } from '@/components/common/inline-alert'
import { LoadingState } from '@/components/common/loading-state'
import { DataRow, MetricBlock, StatRow } from '@/components/data/metric'
import { ProgressBar } from '@/components/data/progress-bar'
import { StatusBadge, type Status } from '@/components/data/status-badge'
import { TrendIndicator } from '@/components/data/trend-indicator'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ICONS } from '@/constants/icons'

const STATUSES: Status[] = [
  'active',
  'completed',
  'on-track',
  'pending',
  'locked',
  'incomplete',
  'warning',
  'failed',
]

export function MetricsSection() {
  return (
    <Section title="Today’s nutrition" meta="MON 21 SEP">
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[1.1fr_1fr]">
        <MetricBlock
          label="Calories"
          icon={ICONS.calories}
          value={1450}
          target={2000}
          unit="KCAL"
          meta="TARGET"
          size="xl"
        />
        <div className="divide-y divide-border">
          <DataRow label="Protein" icon={ICONS.protein} value={105} target={140} unit="G" />
          <DataRow label="Carbs" icon={ICONS.carbs} value={180} target={250} unit="G" />
          <DataRow label="Fat" icon={ICONS.fat} value={48} target={65} unit="G" />
          <DataRow
            label="Fiber"
            icon={ICONS.fiber}
            value={null}
            target={30}
            unit="G"
            meta="NO LOG"
          />
        </div>
      </div>
      <StatRow
        items={[
          { label: 'Steps', value: 7842, icon: ICONS.steps },
          { label: 'Workouts', value: 3, unit: '/ 4', icon: ICONS.workout },
          { label: 'Activities', value: 8, icon: ICONS.activity },
          { label: 'Weight', value: 74.6, unit: 'KG', fractionDigits: 1, icon: ICONS.weight },
        ]}
      />
    </Section>
  )
}

export function ProgressSection() {
  return (
    <Section title="Progress bars" meta="default · complete · attention · no data">
      <div className="grid gap-5 md:grid-cols-2">
        {[
          { label: 'In progress', value: 105, max: 140, tone: 'auto' as const },
          { label: 'Target met', value: 140, max: 140, tone: 'auto' as const },
          { label: 'Above range (attention)', value: 2450, max: 2000, tone: 'attention' as const },
          { label: 'No data logged', value: null, max: 30, tone: 'auto' as const },
        ].map((item) => (
          <div key={item.label} className="space-y-2">
            <p className="label-mono text-muted-foreground">{item.label}</p>
            <ProgressBar
              label={item.label}
              value={item.value}
              max={item.max}
              tone={item.tone}
              size="md"
            />
          </div>
        ))}
      </div>
    </Section>
  )
}

export function StatusSection() {
  return (
    <Section title="Status · trend" meta="icon + text, never colour alone">
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
        <StatusBadge status="active" label="Synced" />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <TrendIndicator delta={-0.8} unit="KG" favorable="down" />
        <TrendIndicator delta={0.6} unit="KG" favorable="down" />
        <TrendIndicator delta={1250} fractionDigits={0} unit="STEPS" />
        <TrendIndicator delta={0} unit="%" />
        <TrendIndicator delta={null} />
      </div>
    </Section>
  )
}

export function StatesSection() {
  return (
    <Section title="States" meta="empty · error · loading · locked · incomplete">
      <div className="grid gap-4 md:grid-cols-2">
        <EmptyState
          icon={ICONS.food}
          title="No records"
          description="Nothing has been logged for this period."
          action={
            <Button size="sm">
              <Plus aria-hidden="true" />
              Add food
            </Button>
          }
        />
        <ErrorState
          title="Couldn’t load meals"
          description="Check your connection and try again."
          action={
            <Button variant="secondary" size="sm">
              Retry
            </Button>
          }
        />
        <div className="rounded-md border border-border p-4">
          <LoadingState label="Loading nutrition" className="py-2" />
          <div className="mt-3 space-y-3" aria-hidden="true">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <InlineAlert tone="info" icon={Lock} title="Locked record">
            Records lock the day after they are logged. Ask an admin for corrections.
          </InlineAlert>
          <InlineAlert tone="warning" title="Profile incomplete">
            Complete your profile to receive personalized recommendations.
          </InlineAlert>
          <InlineAlert tone="success">Recommendation accepted and locked.</InlineAlert>
          <InlineAlert>Enter a quantity greater than 0.</InlineAlert>
        </div>
      </div>
    </Section>
  )
}
