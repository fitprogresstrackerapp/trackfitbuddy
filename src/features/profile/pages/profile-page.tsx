import { EmptyState } from '@/components/common/empty-state'
import { Page, PageHeader, Section } from '@/components/common/page'
import { ICONS } from '@/constants/icons'
import { LogoutButton } from '@/features/auth/components/logout-button'
import { formatIndianPhone } from '@/features/auth/lib/phone'
import { useAccount } from '@/features/auth/auth-context'

export function ProfilePage() {
  const { profile } = useAccount()

  return (
    <Page>
      <PageHeader eyebrow={formatIndianPhone(profile.phone)} title={profile.name ?? 'Profile'} />
      <EmptyState
        icon={ICONS.profile}
        title="Not built yet"
        description="Profile details are implemented in a later phase."
      />
      <Section title="Session">
        <div>
          <LogoutButton variant="outline" />
        </div>
      </Section>
    </Page>
  )
}
