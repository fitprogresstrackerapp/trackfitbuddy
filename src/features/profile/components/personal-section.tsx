import { Pencil } from 'lucide-react'
import { useState } from 'react'

import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { ageOn, formatShortDate } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'

import type { ProfileDetails } from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { friendlyProfileError } from '../lib/profile-logic'
import { GENDER_OPTIONS } from '../schemas'
import { BasicsStep } from './basics-step'
import { Detail, DetailList, EditSheet, NotSet } from './profile-ui'

interface PersonalSectionProps {
  details: ProfileDetails
  today: string
  mutations: ReturnType<typeof useProfileMutations>
}

/** Name, date of birth (age is derived, never stored) and gender. */
export function PersonalSection({ details, today, mutations }: PersonalSectionProps) {
  const [open, setOpen] = useState(false)
  const gender = GENDER_OPTIONS.find((option) => option.value === details.gender)?.label

  return (
    <Section
      title="Personal"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(true)
          }}
        >
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      }
    >
      <DetailList>
        <Detail label="Name">{details.name ?? <NotSet />}</Detail>
        <Detail label="Date of birth">
          {details.dateOfBirth ? (
            <>
              {formatShortDate(details.dateOfBirth)} {details.dateOfBirth.slice(0, 4)}
              <span className="ml-2 text-muted-foreground">
                Age {ageOn(details.dateOfBirth, today)}
              </span>
            </>
          ) : (
            <NotSet />
          )}
        </Detail>
        <Detail label="Gender">{gender ?? <NotSet />}</Detail>
      </DetailList>

      <EditSheet
        open={open}
        onOpenChange={setOpen}
        eyebrow="Personal"
        title="Edit personal details"
      >
        <BasicsStep
          initial={{ name: details.name, dateOfBirth: details.dateOfBirth, gender: details.gender }}
          today={today}
          submitLabel="Save"
          onSubmit={async (input) => {
            try {
              await mutations.personal.mutateAsync(input)
            } catch (error) {
              throw new Error(
                friendlyProfileError(error, 'Couldn’t save your details. Please try again.'),
                { cause: error },
              )
            }
            setOpen(false)
            notify.success('Personal details saved')
          }}
        />
      </EditSheet>
    </Section>
  )
}
