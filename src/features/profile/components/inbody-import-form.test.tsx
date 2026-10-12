import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  InbodyImportError,
  type InbodyCsvFile,
  type InbodyCsvMeasurement,
  type InbodyImportInput,
} from '../api/inbody-import'
import { inbodyCsv } from '../lib/inbody-csv.fixture'
import { InbodyImportForm } from './inbody-import-form'

const MEASUREMENT: InbodyCsvMeasurement = {
  measuredAt: '2026-09-20T07:30:15',
  date: '2026-09-20',
  weightKg: 81.5,
  bodyFatPercent: 21,
  muscleMassKg: 36.4,
  bmi: null,
  bmrKcal: 1761,
  other: [{ label: 'Protein', value: 12.8, unit: 'kg' }],
  future: false,
  hasResults: false,
  reports: [],
}
const REVIEW_NOTE =
  'These values were imported from your InBody CSV. Please review them before saving.'

const csvFile = (name = 'InBody.csv') =>
  new File([inbodyCsv('20260920073015')], name, { type: 'text/csv' })

function setup(
  options: {
    report?: { id: string; date: string }
    measurements?: InbodyCsvMeasurement[]
    onParse?: (file: InbodyCsvFile) => Promise<InbodyCsvMeasurement[]>
    onSave?: (input: InbodyImportInput) => Promise<void>
  } = {},
) {
  const onParse = vi.fn(
    options.onParse ?? (() => Promise.resolve(options.measurements ?? [MEASUREMENT])),
  )
  const onSave = vi.fn(options.onSave ?? (() => Promise.resolve()))
  render(<InbodyImportForm report={options.report ?? null} onParse={onParse} onSave={onSave} />)
  return { onParse, onSave }
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText('InBody CSV file'), { target: { files: [file] } })
}

async function readCsv(file = csvFile()) {
  choose(file)
  fireEvent.click(screen.getByRole('button', { name: 'Read CSV' }))
  await screen.findByText(REVIEW_NOTE)
}

const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save results' })

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('InBody CSV import form', () => {
  it('asks for a file and refuses a file that is not a CSV before contacting the server', async () => {
    const { onParse } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Read CSV' }))
    expect(await screen.findByText('Choose the CSV file')).toBeTruthy()

    choose(new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Read CSV' }))
    expect(
      await screen.findByText('Choose the CSV file exported from the InBody app (.csv).'),
    ).toBeTruthy()
    expect(onParse).not.toHaveBeenCalled()
  })

  it('shows a reading state and sends the file once', async () => {
    let finish: (rows: InbodyCsvMeasurement[]) => void = () => undefined
    const { onParse } = setup({
      onParse: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    choose(csvFile())
    fireEvent.click(screen.getByRole('button', { name: 'Read CSV' }))
    const reading = await screen.findByRole<HTMLButtonElement>('button', { name: 'Reading CSV…' })
    expect(reading.disabled).toBe(true)
    fireEvent.click(reading)
    await waitFor(() => {
      expect(onParse).toHaveBeenCalledTimes(1)
    })
    expect(onParse.mock.calls[0]?.[0]).toMatchObject({ filename: 'InBody.csv' })
    expect(onParse.mock.calls[0]?.[0].csv).toContain('Weight(kg)')
    finish([MEASUREMENT])
    expect(await screen.findByText(REVIEW_NOTE)).toBeTruthy()
  })

  it('shows the extracted values for review and saves nothing until confirmed', async () => {
    const { onSave } = setup()
    await readCsv()
    const text = document.body.textContent
    expect(text).toContain('81.5 kg')
    expect(text).toContain('21%')
    expect(text).toContain('36.4 kg')
    expect(text).toContain('1,761 kcal')
    expect(text).toContain('12.8 kg')
    // A value the CSV does not have is shown as missing, never as zero.
    expect(text).toContain('BMINot in the CSV')
    expect(text).toContain('The CSV will be saved as a new InBody record')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves on confirmation, once, with the file and never the values', async () => {
    let finish: () => void = () => undefined
    const { onSave } = setup({
      onSave: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    })
    await readCsv()
    fireEvent.click(saveButton())
    const saving = await screen.findByRole<HTMLButtonElement>('button', { name: 'Saving…' })
    expect(saving.disabled).toBe(true)
    fireEvent.click(saving)
    expect(onSave).toHaveBeenCalledTimes(1)
    const input = onSave.mock.calls[0]?.[0]
    expect(input).toEqual({
      file: { filename: 'InBody.csv', csv: expect.stringContaining('Weight(kg)') as string },
      measuredAt: '2026-09-20T07:30:15',
      reportId: null,
    })
    finish()
  })

  it('attaches to the uploaded report of the same date', async () => {
    const { onSave } = setup({
      measurements: [
        { ...MEASUREMENT, reports: [{ id: 'r1', date: '2026-09-20', sameDate: true }] },
      ],
    })
    await readCsv()
    expect(document.body.textContent).toContain(
      'The results will be added to your uploaded report dated',
    )
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'r1' }))
    })
  })

  it('asks the user to choose when the only report is dated a day off', async () => {
    const { onSave } = setup({
      measurements: [
        { ...MEASUREMENT, reports: [{ id: 'r2', date: '2026-09-21', sameDate: false }] },
      ],
    })
    await readCsv()
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(saveButton())
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: /Save as a separate result/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Add to my uploaded report dated/ }))
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'r2' }))
    })
  })

  it('refuses a CSV that does not match the selected report', async () => {
    const { onSave } = setup({ report: { id: 'r9', date: '2026-08-01' } })
    await readCsv()
    expect(screen.getByText('This CSV does not match the selected report.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(saveButton())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves to the selected report when the CSV matches it', async () => {
    const { onSave } = setup({
      report: { id: 'r1', date: '2026-09-20' },
      measurements: [
        { ...MEASUREMENT, reports: [{ id: 'r1', date: '2026-09-20', sameDate: true }] },
      ],
    })
    await readCsv()
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'r1' }))
    })
  })

  it('never offers to replace existing results or to save a future measurement', async () => {
    setup({ measurements: [{ ...MEASUREMENT, hasResults: true }] })
    await readCsv()
    expect(document.body.textContent).toContain('InBody results for this date already exist')
    expect(saveButton().disabled).toBe(true)
    cleanup()

    setup({ measurements: [{ ...MEASUREMENT, future: true }] })
    await readCsv()
    expect(screen.getByText('The measurement date can’t be in the future.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it.each([
    ['UNSUPPORTED_FORMAT', /^Unsupported InBody CSV format/],
    ['INVALID_DATE', /^Measurement date could not be found/],
    ['MISSING_COLUMNS', /^Required InBody metrics could not be found/],
    ['INVALID_VALUE', /^One or more values are invalid/],
  ] as const)('explains a refused CSV: %s', async (problem, message) => {
    setup({ onParse: () => Promise.reject(new InbodyImportError('INVALID_CSV', problem)) })
    choose(csvFile())
    fireEvent.click(screen.getByRole('button', { name: 'Read CSV' }))
    expect(await screen.findByText(message)).toBeTruthy()
    // The form is usable again.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Read CSV' }).disabled).toBe(false)
  })

  it('explains a refused save and lets the user try again', async () => {
    const { onSave } = setup({
      onSave: () => Promise.reject(new InbodyImportError('ALREADY_HAS_RESULTS')),
    })
    await readCsv()
    fireEvent.click(saveButton())
    expect(await screen.findByText(/^This report already has results/)).toBeTruthy()
    expect(saveButton().disabled).toBe(false)
    expect(onSave).toHaveBeenCalledTimes(1)
    // An unexpected failure never shows server details.
    cleanup()
    setup({ onSave: () => Promise.reject(new Error('relation "inbody_metrics" …')) })
    await readCsv()
    fireEvent.click(saveButton())
    expect(await screen.findByText('Couldn’t import the CSV. Please try again.')).toBeTruthy()
  })

  it('goes back to choose another file', async () => {
    setup()
    await readCsv()
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }))
    expect(screen.getByLabelText('InBody CSV file')).toBeTruthy()
    expect(screen.queryByText(REVIEW_NOTE)).toBeNull()
  })
})
