import { useLocation } from 'react-router'

import { PlaceholderPage } from '@/components/common/placeholder-page'
import { Breadcrumb } from '@/components/layout/breadcrumb'
import { ADMIN_NAV, findNavItem } from '@/constants/navigation'
import { ROUTES } from '@/constants/routes'

/**
 * Placeholder for every admin section (spec §78) until the Admin feature is
 * built. The section is resolved from the URL, so one lazy chunk serves all.
 */
export function AdminSectionPage() {
  const { pathname } = useLocation()
  const section = findNavItem(ADMIN_NAV, pathname)
  const isDashboard = section?.to === ROUTES.admin
  const title = section?.label ?? 'Admin'

  return (
    <PlaceholderPage
      title={title}
      eyebrow="Control"
      {...(section?.description ? { description: section.description } : {})}
      before={
        <Breadcrumb
          items={
            isDashboard
              ? [{ label: 'Admin' }]
              : [{ label: 'Admin', to: ROUTES.admin }, { label: title }]
          }
        />
      }
    />
  )
}
