import type { LucideIcon } from 'lucide-react'

import { EmptyState } from './empty-state'
import { Page, PageHeader } from './page'

interface PlaceholderPageProps {
  title: string
  icon?: LucideIcon
}

/** Temporary page body for routes whose features are built in later phases. */
export function PlaceholderPage({ title, icon }: PlaceholderPageProps) {
  return (
    <Page>
      <PageHeader eyebrow="Foundation" title={title} />
      <EmptyState
        icon={icon}
        title="Not built yet"
        description="This section is implemented in a later phase."
      />
    </Page>
  )
}
