import { SectionPlaceholder } from '@/components/common/placeholder-page'
import { ROUTES } from '@/constants/routes'

export function HomePage() {
  return <SectionPlaceholder route={ROUTES.home} eyebrow="Today" />
}
