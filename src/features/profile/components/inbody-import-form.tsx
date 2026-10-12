import { useRef, useState, type SubmitEvent } from 'react'

import { FormField } from '@/components/common/form-field'
import { InlineAlert } from '@/components/common/inline-alert'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/choice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDayLabel } from '@/lib/dates/local-date'
import { formatNumber } from '@/lib/format'

import {
  inbodyImportMessage,
  readInbodyCsvFile,
  type InbodyCsvFile,
  type InbodyCsvMeasurement,
  type InbodyImportInput,
} from '../api/inbody-import'
import { Detail, DetailList } from './profile-ui'

const NEW_RECORD = 'new'

interface InbodyImportFormProps {
  /** Set when the import was started from a report awaiting results. */
  report: { id: string; date: string } | null
  onParse: (file: InbodyCsvFile) => Promise<InbodyCsvMeasurement[]>
  onSave: (input: InbodyImportInput) => Promise<void>
}

/**
 * InBody CSV import: choose the file, review what the server read from it,
 * then confirm. Nothing is saved before the confirmation, and the values shown
 * are never sent back: saving submits the file again.
 */
export function InbodyImportForm({ report, onParse, onSave }: InbodyImportFormProps) {
  const [picked, setPicked] = useState<File | null>(null)
  const [file, setFile] = useState<InbodyCsvFile | null>(null)
  const [measurements, setMeasurements] = useState<InbodyCsvMeasurement[] | null>(null)
  const [measuredAt, setMeasuredAt] = useState('')
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusyState] = useState<'reading' | 'saving' | null>(null)
  // Also kept in a ref: two clicks in the same frame both see the old state.
  const busyRef = useRef(false)
  const setBusy = (next: 'reading' | 'saving' | null) => {
    busyRef.current = next !== null
    setBusyState(next)
  }
  const [error, setError] = useState<string | null>(null)

  async function handleRead(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busyRef.current) return
    setError(null)
    if (!picked) {
      setError('Choose the CSV file')
      return
    }
    setBusy('reading')
    try {
      const read = await readInbodyCsvFile(picked)
      const parsed = await onParse(read)
      // Start on the measurement of the report's date, otherwise the newest.
      const first = parsed.find((item) => item.date === report?.date) ?? parsed[0]
      setFile(read)
      setMeasurements(parsed)
      setMeasuredAt(first?.measuredAt ?? '')
      setChoice(null)
    } catch (cause) {
      setError(inbodyImportMessage(cause))
    }
    setBusy(null)
  }

  if (!file || !measurements) {
    return (
      <form noValidate onSubmit={(event) => void handleRead(event)} className="flex flex-col gap-5">
        <FormField
          id="inbody-csv"
          label="InBody CSV file"
          hint="In the InBody app: export your data as CSV, then choose that file here."
        >
          {(control) => (
            <input
              {...control}
              type="file"
              accept=".csv,text/csv"
              disabled={busy !== null}
              onChange={(event) => {
                setPicked(event.target.files?.[0] ?? null)
                setError(null)
              }}
              className="rounded-sm text-sm text-foreground-secondary outline-none file:mr-3 file:cursor-pointer file:rounded-sm file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
            />
          )}
        </FormField>
        {error && <InlineAlert>{error}</InlineAlert>}
        <Button type="submit" size="lg" disabled={busy !== null}>
          {busy ? 'Reading CSV…' : 'Read CSV'}
        </Button>
      </form>
    )
  }

  const measurement = measurements.find((item) => item.measuredAt === measuredAt)
  const destination = measurement ? destinationFor(measurement, report, choice) : null

  async function handleSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busyRef.current || !file || !measurement || !destination?.target) return
    setError(null)
    setBusy('saving')
    try {
      await onSave({
        file,
        measuredAt: measurement.measuredAt,
        reportId: destination.target === NEW_RECORD ? null : destination.target,
      })
    } catch (cause) {
      setError(inbodyImportMessage(cause))
      setBusy(null)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handleSave(event)} className="flex flex-col gap-5">
      <InlineAlert tone="info">
        These values were imported from your InBody CSV. Please review them before saving.
      </InlineAlert>

      {measurements.length > 1 && (
        <FormField
          id="inbody-measurement"
          label="Measurement"
          hint={`This CSV has ${String(measurements.length)} measurements. One is saved at a time.`}
        >
          {(control) => (
            <Select
              value={measuredAt}
              onValueChange={(value) => {
                setMeasuredAt(value)
                setChoice(null)
                setError(null)
              }}
              disabled={busy !== null}
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {measurements.map((item) => (
                  <SelectItem key={item.measuredAt} value={item.measuredAt}>
                    {formatDayLabel(item.date)} · {item.measuredAt.slice(11, 16)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}

      {measurement && <Review measurement={measurement} />}

      {destination?.options && (
        <RadioGroup
          aria-label="Where to save these results"
          value={choice ?? ''}
          onValueChange={setChoice}
          disabled={busy !== null}
        >
          {destination.options.map((option) => (
            <div key={option.value} className="flex items-center gap-2.5">
              <RadioGroupItem id={`inbody-target-${option.value}`} value={option.value} />
              <label htmlFor={`inbody-target-${option.value}`} className="text-sm text-foreground">
                {option.label}
              </label>
            </div>
          ))}
        </RadioGroup>
      )}
      {destination?.note && <p className="text-sm text-foreground-secondary">{destination.note}</p>}
      {destination?.blocked && <InlineAlert tone="warning">{destination.blocked}</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={busy !== null || !destination?.target}>
          {busy === 'saving' ? 'Saving…' : 'Save results'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => {
            setFile(null)
            setMeasurements(null)
            setPicked(null)
            setError(null)
          }}
        >
          Choose another file
        </Button>
      </div>
    </form>
  )
}

interface Destination {
  /** A report id, NEW_RECORD, or null while nothing can be saved yet. */
  target: string | null
  note?: string
  blocked?: string
  options?: { value: string; label: string }[]
}

/**
 * Where a measurement may be saved. A CSV is never attached to a report of
 * another date without the user choosing it, and never replaces results.
 */
function destinationFor(
  measurement: InbodyCsvMeasurement,
  report: { id: string; date: string } | null,
  choice: string | null,
): Destination {
  const date = formatDayLabel(measurement.date)
  if (measurement.future) {
    return { target: null, blocked: 'The measurement date can’t be in the future.' }
  }
  if (report) {
    const match = measurement.reports.find((item) => item.id === report.id)
    if (!match) return { target: null, blocked: 'This CSV does not match the selected report.' }
    return {
      target: report.id,
      note: match.sameDate
        ? `The results will be added to your report dated ${formatDayLabel(report.date)}.`
        : `The results will be added to your report dated ${formatDayLabel(report.date)}. The report will take the measurement date, ${date}.`,
    }
  }
  const sameDate = measurement.reports.find((item) => item.sameDate)
  if (sameDate) {
    return {
      target: sameDate.id,
      note: `The results will be added to your uploaded report dated ${formatDayLabel(sameDate.date)}.`,
    }
  }
  const existing =
    'InBody results for this date already exist. They can’t be replaced; ask an admin if a value needs correcting.'
  if (measurement.reports.length > 0) {
    const options = [
      ...measurement.reports.map((item) => ({
        value: item.id,
        label: `Add to my uploaded report dated ${formatDayLabel(item.date)}`,
      })),
      ...(measurement.hasResults
        ? []
        : [{ value: NEW_RECORD, label: `Save as a separate result for ${date}` }]),
    ]
    return {
      target: options.some((option) => option.value === choice) ? choice : null,
      options,
      note: `The measurement is dated ${date}. Choose where to save it.`,
    }
  }
  if (measurement.hasResults) return { target: null, blocked: existing }
  return {
    target: NEW_RECORD,
    note: `No uploaded report matches ${date}. The CSV will be saved as a new InBody record for that date.`,
  }
}

function Review({ measurement }: { measurement: InbodyCsvMeasurement }) {
  const value = (number: number | null, digits: number, unit: string) =>
    number === null ? (
      <span className="text-muted-foreground">Not in the CSV</span>
    ) : (
      `${formatNumber(number, digits)}${unit}`
    )
  return (
    <DetailList className="mt-0 border-t">
      <Detail label="Measured">
        {formatDayLabel(measurement.date)} · {measurement.measuredAt.slice(11, 16)}
      </Detail>
      <Detail label="Weight">{value(measurement.weightKg, 1, ' kg')}</Detail>
      <Detail label="Body fat">{value(measurement.bodyFatPercent, 1, '%')}</Detail>
      <Detail label="Muscle mass">{value(measurement.muscleMassKg, 1, ' kg')}</Detail>
      <Detail label="BMI">{value(measurement.bmi, 1, '')}</Detail>
      <Detail label="BMR">{value(measurement.bmrKcal, 0, ' kcal')}</Detail>
      {measurement.other.map((metric) => (
        <Detail key={metric.label} label={metric.label}>
          {formatNumber(metric.value, 2)}
          {metric.unit ? ` ${metric.unit}` : ''}
        </Detail>
      ))}
    </DetailList>
  )
}
