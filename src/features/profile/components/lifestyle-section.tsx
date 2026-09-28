import { Pencil } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'
import { z } from 'zod'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/feedback'

import type { ProfileDetails } from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { ACTIVITY_LEVEL_LABELS } from '../lib/goals'
import { friendlyProfileError } from '../lib/profile-logic'
import { lifestyleSchema } from '../schemas'
import { Detail, DetailList, EditSheet, NotSet } from './profile-ui'

const NOT_SET = 'NOT_SET'

interface LifestyleSectionProps {
  details: ProfileDetails
  mutations: ReturnType<typeof useProfileMutations>
}

/**
 * Optional context for future recommendations (spec §23). Editing it never
 * changes current targets, and hobbies never create activity records.
 */
export function LifestyleSection({ details, mutations }: LifestyleSectionProps) {
  const [open, setOpen] = useState(false)

  return (
    <Section
      title="Lifestyle"
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
        <Detail label="Activity level">
          {details.activityLevel ? ACTIVITY_LEVEL_LABELS[details.activityLevel] : <NotSet />}
        </Detail>
        <Detail label="Job">{details.job ?? <NotSet />}</Detail>
        <Detail label="Hobbies / sports">{details.hobbies ?? <NotSet />}</Detail>
      </DetailList>
      <p className="text-xs text-muted-foreground">
        Optional. Used as context for your next recommendation; it doesn’t change current targets.
      </p>

      <EditSheet open={open} onOpenChange={setOpen} eyebrow="Lifestyle" title="Edit lifestyle">
        <LifestyleForm
          details={details}
          onSave={async (input) => {
            try {
              await mutations.lifestyle.mutateAsync(input)
            } catch (error) {
              throw new Error(
                friendlyProfileError(error, 'Couldn’t save your lifestyle. Please try again.'),
                { cause: error },
              )
            }
            setOpen(false)
            notify.success('Lifestyle saved')
          }}
        />
      </EditSheet>
    </Section>
  )
}

function LifestyleForm({
  details,
  onSave,
}: {
  details: ProfileDetails
  onSave: (input: z.output<typeof lifestyleSchema>) => Promise<void>
}) {
  const [activityLevel, setActivityLevel] = useState<string>(details.activityLevel ?? NOT_SET)
  const [job, setJob] = useState(details.job ?? '')
  const [hobbies, setHobbies] = useState(details.hobbies ?? '')
  const [errors, setErrors] = useState<Partial<Record<'job' | 'hobbies', string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const parsed = lifestyleSchema.safeParse({
      activityLevel: activityLevel === NOT_SET ? '' : activityLevel,
      job,
      hobbies,
    })
    if (!parsed.success) {
      const { fieldErrors } = z.flattenError(parsed.error)
      setErrors({ job: fieldErrors.job?.[0], hobbies: fieldErrors.hobbies?.[0] })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      await onSave(parsed.data)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <FormField id="activity-level" label="Activity level (optional)">
        {(control) => (
          <Select value={activityLevel} onValueChange={setActivityLevel} disabled={saving}>
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_SET}>Not set</SelectItem>
              {Object.entries(ACTIVITY_LEVEL_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </FormField>
      <FormField id="job" label="Job (optional)" error={errors.job} hint="e.g. Software engineer">
        {(control) => (
          <Input
            {...control}
            autoComplete="organization-title"
            maxLength={200}
            value={job}
            onChange={(event) => {
              setJob(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      <FormField
        id="hobbies"
        label="Hobbies / sports (optional)"
        error={errors.hobbies}
        hint="e.g. Cricket, badminton, trekking"
      >
        {(control) => (
          <Textarea
            {...control}
            maxLength={500}
            rows={3}
            value={hobbies}
            onChange={(event) => {
              setHobbies(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
