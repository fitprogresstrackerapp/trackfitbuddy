import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'
import { useAccount, useAuth } from '@/features/auth/auth-context'
import { todayInTimeZone } from '@/lib/dates/local-date'
import { getSupabaseClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

import { saveBasics, saveMeasurements } from '../api/onboarding'
import { BasicsStep } from '../components/basics-step'
import { MeasurementsStep } from '../components/measurements-step'

const STEPS = [
  { number: 1, title: 'Basic information' },
  { number: 2, title: 'Body measurements' },
] as const

type StepNumber = (typeof STEPS)[number]['number']

/**
 * Mandatory first-time onboarding. Each step is saved to the server when
 * completed, so a refresh resumes at the first incomplete step. Completion is
 * decided by the database readiness view, not by this page.
 */
export function OnboardingPage() {
  const { profile } = useAccount()
  const { refreshAccount, signOut } = useAuth()
  const navigate = useNavigate()
  const [supabase] = useState(getSupabaseClient)

  const basicsSaved = Boolean(profile.name && profile.dateOfBirth && profile.gender)
  const [step, setStep] = useState<StepNumber>(basicsSaved ? 2 : 1)
  const today = todayInTimeZone(profile.timezone)
  const current = STEPS[step - 1] ?? STEPS[0]

  async function handleLogout() {
    await signOut()
    void navigate(ROUTES.login, { replace: true })
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="label-mono text-foreground" aria-label={`Step ${step} of ${STEPS.length}`}>
            {String(step).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
          </p>
          <Button variant="ghost" size="sm" onClick={() => void handleLogout()}>
            Log out
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-1" aria-hidden="true">
          {STEPS.map((item) => (
            <span
              key={item.number}
              className={cn('h-1 rounded-xs', item.number <= step ? 'bg-primary' : 'bg-surface-2')}
            />
          ))}
        </div>

        <div className="rounded-md bg-destructive px-3 py-2.5 text-destructive-foreground">
          <p className="label-section">Profile incomplete</p>
          <p className="text-sm">Complete your profile to continue.</p>
        </div>

        <h1 className="heading-page text-foreground">{current.title}</h1>
      </header>

      {step === 1 ? (
        <BasicsStep
          initial={{ name: profile.name, dateOfBirth: profile.dateOfBirth, gender: profile.gender }}
          today={today}
          onSubmit={async (input) => {
            await saveBasics(supabase, profile.id, input)
            await refreshAccount()
            setStep(2)
          }}
        />
      ) : (
        <MeasurementsStep
          initialHeightCm={profile.heightCm}
          onBack={() => {
            setStep(1)
          }}
          onSubmit={async (input) => {
            await saveMeasurements(supabase, input)
            // Readiness becomes complete → the route guard moves to Home.
            await refreshAccount()
          }}
        />
      )}
    </div>
  )
}
