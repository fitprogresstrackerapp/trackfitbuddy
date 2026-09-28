import type { UseQueryResult } from '@tanstack/react-query'
import { ExternalLink, Upload } from 'lucide-react'
import { useState, type SubmitEvent } from 'react'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { SectionError } from '@/components/common/section-error'
import { StatusBadge, type Status } from '@/components/data/status-badge'
import { Section } from '@/components/layout/page'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDayLabel, isValidIsoDate } from '@/lib/dates/local-date'
import { notify } from '@/lib/feedback'
import { formatNumber } from '@/lib/format'
import { getSupabaseClient } from '@/lib/supabase/client'

import {
  INBODY_FILE_TYPES,
  INBODY_MAX_BYTES,
  inbodyReportUrl,
  type InbodyReport,
} from '../api/profile-data'
import type { useProfileMutations } from '../api/profile-queries'
import { friendlyProfileError } from '../lib/profile-logic'
import { EditSheet } from './profile-ui'

const STATUS: Record<InbodyReport['status'], { status: Status; label: string }> = {
  PENDING: { status: 'pending', label: 'Awaiting results' },
  PROCESSING: { status: 'pending', label: 'Awaiting results' },
  COMPLETED: { status: 'completed', label: 'Results added' },
  FAILED: { status: 'warning', label: 'Results unavailable' },
}

interface InbodySectionProps {
  reports: UseQueryResult<InbodyReport[]>
  today: string
  mutations: ReturnType<typeof useProfileMutations>
}

/**
 * InBody (spec §21): the original report is stored; structured metrics are
 * added later by processing or an admin — nothing is read from the file here.
 * Only stored metrics are shown. A new upload is always a new record.
 */
export function InbodySection({ reports, today, mutations }: InbodySectionProps) {
  const [open, setOpen] = useState(false)

  return (
    <Section
      title="InBody"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(true)
          }}
        >
          <Upload aria-hidden="true" />
          Upload report
        </Button>
      }
    >
      {reports.isError ? (
        <SectionError title="InBody reports unavailable" onRetry={() => void reports.refetch()} />
      ) : reports.isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : reports.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No InBody reports yet. InBody is optional; upload one whenever you have a scan.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {reports.data.map((report) => (
            <li key={report.id} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-mono text-foreground">{formatDayLabel(report.date)}</span>
                <StatusBadge {...STATUS[report.status]} />
                <ViewReport path={report.filePath} />
              </div>
              {report.metrics && <Metrics metrics={report.metrics} />}
            </li>
          ))}
        </ul>
      )}

      <EditSheet
        open={open}
        onOpenChange={setOpen}
        eyebrow="InBody"
        title="Upload InBody report"
        description="The file is stored privately. Results are added once the report has been reviewed."
      >
        <UploadForm
          today={today}
          onSave={async (input) => {
            try {
              await mutations.inbody.mutateAsync(input)
            } catch (error) {
              throw new Error(
                friendlyProfileError(error, 'Couldn’t upload the report. Please try again.'),
                { cause: error },
              )
            }
            setOpen(false)
            notify.success('Report uploaded', formatDayLabel(input.date))
          }}
        />
      </EditSheet>
    </Section>
  )
}

function Metrics({ metrics }: { metrics: NonNullable<InbodyReport['metrics']> }) {
  const items = [
    metrics.weightKg !== null && ['Weight', `${formatNumber(metrics.weightKg, 1)} kg`],
    metrics.bodyFatPercent !== null && ['Body fat', `${formatNumber(metrics.bodyFatPercent, 1)}%`],
    metrics.muscleMassKg !== null && ['Muscle mass', `${formatNumber(metrics.muscleMassKg, 1)} kg`],
    metrics.bmi !== null && ['BMI', formatNumber(metrics.bmi, 1)],
    metrics.bmrKcal !== null && ['BMR', `${formatNumber(metrics.bmrKcal)} kcal`],
  ].filter((item): item is [string, string] => Array.isArray(item))
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-2">
          <dt className="label-mono text-muted-foreground">{label}</dt>
          <dd className="text-sm text-foreground tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ViewReport({ path }: { path: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="link"
      className="ml-auto"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        inbodyReportUrl(getSupabaseClient(), path)
          .then((url) => {
            window.open(url, '_blank', 'noopener,noreferrer')
          })
          .catch(() => {
            notify.error('Couldn’t open the report')
          })
          .finally(() => {
            setBusy(false)
          })
      }}
    >
      <ExternalLink aria-hidden="true" />
      View file
    </Button>
  )
}

function UploadForm({
  today,
  onSave,
}: {
  today: string
  onSave: (input: { date: string; file: File }) => Promise<void>
}) {
  const [date, setDate] = useState(today)
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Partial<Record<'date' | 'file', string>>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    const next: Partial<Record<'date' | 'file', string>> = {}
    if (!isValidIsoDate(date)) next.date = 'Enter a valid date'
    else if (date > today) next.date = 'The date can’t be in the future'
    if (!file) next.file = 'Choose the report file'
    else if (!(INBODY_FILE_TYPES as readonly string[]).includes(file.type))
      next.file = 'Use a PDF or an image (JPG, PNG, WebP, HEIC)'
    else if (file.size > INBODY_MAX_BYTES) next.file = 'The file must be 10 MB or smaller'
    setErrors(next)
    if (Object.keys(next).length > 0 || !file) return
    setSaving(true)
    try {
      await onSave({ date, file })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      <FormField id="inbody-date" label="Scan date" error={errors.date}>
        {(control) => (
          <DatePicker
            {...control}
            value={date}
            max={today}
            onChange={(event) => {
              setDate(event.target.value)
            }}
            disabled={saving}
          />
        )}
      </FormField>
      <FormField
        id="inbody-file"
        label="Report file"
        error={errors.file}
        hint="PDF or image, up to 10 MB"
      >
        {(control) => (
          <input
            {...control}
            type="file"
            accept={INBODY_FILE_TYPES.join(',')}
            disabled={saving}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
            }}
            className="text-sm text-foreground-secondary file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-foreground"
          />
        )}
      </FormField>
      {saveError && <InlineAlert>{saveError}</InlineAlert>}
      <Button type="submit" size="lg" disabled={saving}>
        {saving ? 'Uploading…' : 'Upload'}
      </Button>
    </form>
  )
}
