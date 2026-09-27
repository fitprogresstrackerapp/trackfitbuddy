import { Page } from '@/components/layout/page'
import { useAccount } from '@/features/auth/auth-context'
import { safeTimeZone, todayInTimeZone } from '@/lib/dates/local-date'

import { useHomeNutrition, useHomePlan, useHomeTraining } from '../api/home-queries'
import { HomeHeader } from '../components/home-header'
import { FocusSection, HomeActions, NextPanel } from '../components/next-and-focus'
import { NutritionSection } from '../components/nutrition-section'
import { TodaySection } from '../components/today-section'

/**
 * Today-focused dashboard (spec §9). "Today" is the calendar day in the
 * user's profile timezone — the same day the database uses for locking.
 * Three independent queries, so one failing section never blanks the page.
 */
export function HomePage() {
  const { profile } = useAccount()
  const timeZone = safeTimeZone(profile.timezone)
  const today = todayInTimeZone(timeZone)

  const plan = useHomePlan(profile.id, today)
  const nutrition = useHomeNutrition(profile.id, today)
  const training = useHomeTraining(profile.id, today)

  return (
    <Page>
      <HomeHeader name={profile.name} today={today} timeZone={timeZone} plan={plan} />
      <NutritionSection plan={plan} nutrition={nutrition} />
      <TodaySection training={training} plan={plan} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <NextPanel plan={plan} nutrition={nutrition} training={training} />
          <HomeActions />
        </div>
        <FocusSection plan={plan} />
      </div>
    </Page>
  )
}
