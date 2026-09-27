import { PlaceholderPage } from '@/components/common/placeholder-page'
import { Section } from '@/components/layout/page'
import { PROFILE_NAV } from '@/constants/navigation'
import { useAccount } from '@/features/auth/auth-context'
import { LogoutButton } from '@/features/auth/components/logout-button'

/** Placeholder until profile editing is built. Logout is real and stays here. */
export function ProfilePage() {
  const { profile } = useAccount()

  return (
    <PlaceholderPage
      title={profile.name ?? PROFILE_NAV.label}
      eyebrow="Account"
      {...(PROFILE_NAV.description ? { description: PROFILE_NAV.description } : {})}
    >
      <Section title="Session">
        <div>
          <LogoutButton variant="secondary" />
        </div>
      </Section>
    </PlaceholderPage>
  )
}
