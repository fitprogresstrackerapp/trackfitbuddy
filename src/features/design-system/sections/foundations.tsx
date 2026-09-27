import { Divider, Panel, Section } from '@/components/layout/page'
import { ICONS } from '@/constants/icons'

const COLORS = [
  { token: 'background', hex: '#0A0B0A', className: 'bg-background' },
  { token: 'surface-1', hex: '#111311', className: 'bg-surface-1' },
  { token: 'surface-2', hex: '#171917', className: 'bg-surface-2' },
  { token: 'border', hex: '#2A2D2A', className: 'bg-border' },
  { token: 'foreground', hex: '#F1EFE7', className: 'bg-foreground' },
  { token: 'foreground-secondary', hex: '#A5A49D', className: 'bg-foreground-secondary' },
  { token: 'muted-foreground', hex: '#6F716C', className: 'bg-muted-foreground' },
  { token: 'primary', hex: '#7C9686', className: 'bg-primary' },
  { token: 'primary-surface', hex: '#18221C', className: 'bg-primary-surface' },
  { token: 'warning', hex: '#B59A68', className: 'bg-warning' },
  { token: 'destructive', hex: '#B87570', className: 'bg-destructive' },
] as const

export function TypographySection() {
  return (
    <Section title="Typography" meta="Inter · Barlow Condensed · JetBrains Mono">
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">metric — display numbers</p>
            <p className="flex items-baseline gap-2">
              <span className="metric text-6xl text-foreground">1,450</span>
              <span className="label-mono text-muted-foreground">/ 2,000 KCAL</span>
            </p>
          </div>
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">heading-page — page titles</p>
            <p className="heading-page text-foreground">Progress</p>
          </div>
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">
              heading-block — block / dialog titles
            </p>
            <p className="heading-block text-foreground">Weekly workout completion</p>
          </div>
        </div>
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">
              label-section — section and field labels
            </p>
            <p className="label-section text-foreground-secondary">Today’s nutrition</p>
          </div>
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">label-mono — metadata only</p>
            <p className="flex flex-wrap gap-4 label-mono text-foreground-secondary">
              <span>SEP 21</span>
              <span>CYCLE 03</span>
              <span>TARGET</span>
              <span>SYNCED</span>
              <span>7D</span>
            </p>
          </div>
          <div className="space-y-2">
            <p className="label-mono text-muted-foreground">body — sans</p>
            <p className="max-w-prose text-sm text-foreground-secondary">
              Estimated based on the default workout assumption. Actual expenditure may vary.
            </p>
          </div>
        </div>
      </div>
    </Section>
  )
}

export function ColorsSection() {
  return (
    <Section title="Colour tokens" meta="spec §2 — no other colours">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {COLORS.map((color) => (
          <div key={color.token} className="flex items-center gap-3">
            <span
              className={`size-9 shrink-0 rounded-sm border border-border ${color.className}`}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm text-foreground">{color.token}</span>
              <span className="label-mono text-muted-foreground">{color.hex}</span>
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function SurfacesSection() {
  return (
    <Section title="Surfaces" meta="Section · Panel · Divider">
      <p className="max-w-prose text-sm text-foreground-secondary">
        Sections separate content with a labelled rule. Panels are used only when a group needs its
        own ground; the accent panel marks the one block that matters most on a screen.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Surface panel" meta="DEFAULT">
          <p className="text-sm text-foreground-secondary">Raised block for grouped data.</p>
        </Panel>
        <Panel title="Outline panel" meta="OUTLINE" variant="outline">
          <p className="text-sm text-foreground-secondary">Same ground as the page.</p>
        </Panel>
        <Panel title="Accent panel" meta="FOCUS" variant="accent">
          <p className="text-sm text-foreground-secondary">Next session: Lower body · 45–60 min.</p>
        </Panel>
      </div>
      <div className="flex h-10 items-center gap-4 text-sm text-foreground-secondary">
        <span>Left</span>
        <Divider orientation="vertical" />
        <span>Right</span>
      </div>
    </Section>
  )
}

export function IconsSection() {
  return (
    <Section title="Icons" meta="lucide · 1.5–2px stroke">
      <div className="overflow-hidden rounded-md border border-border">
        <div className="-mt-px -ml-px grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
          {Object.entries(ICONS).map(([name, Icon]) => (
            <div
              key={name}
              className="flex flex-col items-center gap-2 border-t border-l border-border px-2 py-4"
            >
              <Icon aria-hidden="true" className="size-5 text-foreground-secondary" />
              <span className="label-mono text-muted-foreground">{name}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}
