import { Brand } from '@/app/layouts/components/brand'
import { StatusBadge } from '@/components/data/status-badge'
import { Page, PageHeader } from '@/components/layout/page'

import { ButtonsSection, FormsSection, SelectionSection } from './sections/controls'
import {
  MetricsSection,
  ProgressSection,
  StatesSection,
  StatusSection,
} from './sections/data-display'
import {
  ColorsSection,
  IconsSection,
  SurfacesSection,
  TypographySection,
} from './sections/foundations'
import { NavigationSection, OverlaysSection } from './sections/overlays-navigation'

/**
 * Development-only visual reference for the design system
 * (route registered only when import.meta.env.DEV). All content is static
 * example data — it never reads account or Supabase data.
 */
export function DesignSystemPage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex h-top-bar max-w-(--container-content) items-center gap-3 px-4 sm:px-6 lg:px-12">
          <Brand />
          <StatusBadge status="warning" label="Dev only" className="ml-auto" />
        </div>
      </header>
      <main
        id="main"
        className="mx-auto w-full max-w-(--container-content) px-4 pt-8 sm:px-6 lg:px-12 lg:pt-12"
      >
        <Page>
          <PageHeader
            eyebrow="Internal · static examples"
            title="Design system"
            description="Primitives and patterns for every feature screen. Static example data only."
          />
          <TypographySection />
          <ColorsSection />
          <SurfacesSection />
          <MetricsSection />
          <ProgressSection />
          <StatusSection />
          <ButtonsSection />
          <FormsSection />
          <SelectionSection />
          <StatesSection />
          <OverlaysSection />
          <NavigationSection />
          <IconsSection />
        </Page>
      </main>
    </div>
  )
}
