import { ErrorState } from '@/components/common/error-state'
import { InlineAlert } from '@/components/common/inline-alert'
import { StatusBadge } from '@/components/data/status-badge'
import { Page, PageHeader, Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccount } from '@/features/auth/auth-context'
import { LogoutButton } from '@/features/auth/components/logout-button'
import { CheckInSection } from '@/features/recommendations/components/check-in-section'
import { RecommendationHistory } from '@/features/recommendations/components/recommendation-history'
import { safeTimeZone, todayInTimeZone } from '@/lib/dates/local-date'

import {
  useInbodyReports,
  usePlan,
  useProfileDetails,
  useProfileMutations,
  useRecentSteps,
  useWeights,
} from '../api/profile-queries'
import { BodySection } from '../components/body-section'
import { GoalsSection } from '../components/goals-section'
import { InbodySection } from '../components/inbody-section'
import { LifestyleSection } from '../components/lifestyle-section'
import { PersonalSection } from '../components/personal-section'
import { PlanSection } from '../components/plan-section'
import { Detail, DetailList } from '../components/profile-ui'
import { StepsSection } from '../components/steps-section'
import { missingFieldLabels } from '../lib/profile-logic'

/**
 * Profile (spec §20–23, §29–33; monthly check-in §31): who the user is, what they want, what they
 * measure, and the current plan — kept as separate kinds of data. Each section
 * edits its own data; onboarding stays first-time setup only.
 */
export function ProfilePage() {
  const account = useAccount()
  const { profile, readiness } = account
  const today = todayInTimeZone(safeTimeZone(profile.timezone))

  const details = useProfileDetails(profile.id)
  const weights = useWeights(profile.id)
  const steps = useRecentSteps(profile.id, today)
  const inbody = useInbodyReports(profile.id)
  const plan = usePlan(profile.id, today)
  const mutations = useProfileMutations(profile.id)
  const missing = missingFieldLabels(readiness.missingFields)

  return (
    <Page>
      <PageHeader
        eyebrow="Profile"
        title={profile.name ?? 'Profile'}
        description={profile.phone}
        actions={
          readiness.isComplete ? (
            <StatusBadge status="completed" label="Profile complete" />
          ) : (
            <StatusBadge status="incomplete" label="Profile incomplete" />
          )
        }
      />

      {!readiness.isComplete && (
        <InlineAlert
          tone="warning"
          title={`${String(missing.length)} required ${missing.length === 1 ? 'field' : 'fields'} remaining`}
        >
          Complete these required fields: {missing.join(', ')}.
        </InlineAlert>
      )}

      {details.isError ? (
        <ErrorState
          title="Profile unavailable"
          description="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void details.refetch()}>
              Retry
            </Button>
          }
        />
      ) : details.isPending ? (
        <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0" aria-hidden="true">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
            <PersonalSection details={details.data} today={today} mutations={mutations} />
            <LifestyleSection details={details.data} mutations={mutations} />
          </div>
          <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
            <BodySection
              details={details.data}
              weights={weights}
              inbody={inbody}
              today={today}
              mutations={mutations}
            />
            <StepsSection steps={steps} today={today} mutations={mutations} />
          </div>
          <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
            <GoalsSection plan={plan} details={details.data} mutations={mutations} />
            <InbodySection reports={inbody} today={today} mutations={mutations} />
          </div>
          <PlanSection plan={plan} today={today} mutations={mutations} />
          <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
            <CheckInSection userId={profile.id} today={today} />
            <RecommendationHistory userId={profile.id} today={today} />
          </div>
          <Section title="Account">
            <DetailList>
              <Detail label="Phone">{details.data.phone}</Detail>
              <Detail label="Timezone">{details.data.timezone}</Detail>
            </DetailList>
            <div>
              <LogoutButton variant="secondary" />
            </div>
          </Section>
        </>
      )}
    </Page>
  )
}
