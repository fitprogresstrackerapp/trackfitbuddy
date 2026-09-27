import type { ReactNode } from 'react'

import { StatusBadge } from '@/components/data/status-badge'
import { Page, PageHeader } from '@/components/layout/page'
import { ADMIN_NAV, findNavItem, PRIMARY_NAV, PROFILE_NAV } from '@/constants/navigation'
import type { AppRoute } from '@/constants/routes'

interface PlaceholderPageProps {
  title: string
  eyebrow?: ReactNode
  description?: string
  /** Rendered above the page header (e.g. a breadcrumb). */
  before?: ReactNode
  children?: ReactNode
}

/**
 * Temporary body for sections built in later phases. States plainly that the
 * section is not available yet — no fake data.
 */
export function PlaceholderPage({
  title,
  eyebrow,
  description,
  before,
  children,
}: PlaceholderPageProps) {
  return (
    <Page>
      <div className="flex flex-col gap-4">
        {before}
        <PageHeader title={title} eyebrow={eyebrow} description={description} />
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <StatusBadge status="pending" label="Coming next" />
        <p className="text-sm text-muted-foreground">This section is built in an upcoming phase.</p>
      </div>
      {children}
    </Page>
  )
}

interface SectionPlaceholderProps {
  route: AppRoute
  eyebrow: string
}

/** Placeholder for a primary section, titled and described from the nav config. */
export function SectionPlaceholder({ route, eyebrow }: SectionPlaceholderProps) {
  const item = findNavItem([...PRIMARY_NAV, PROFILE_NAV, ...ADMIN_NAV], route)
  return (
    <PlaceholderPage
      title={item?.label ?? 'Section'}
      eyebrow={eyebrow}
      {...(item?.description ? { description: item.description } : {})}
    />
  )
}
