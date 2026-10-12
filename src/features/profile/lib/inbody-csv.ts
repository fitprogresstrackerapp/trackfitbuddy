/*
 * InBody CSV import: a deterministic parser for the CSV that the InBody app
 * exports ("Export data"), one row per measurement.
 *
 *   Date,Measurement device.,Weight(kg),Skeletal Muscle Mass(kg),…,Percent Body Fat(%),…
 *   20261012073015,570,78.4,34.2,-,14.6,24.3,18.7,1742,…
 *
 * Format facts this parser relies on (anything else is rejected, never guessed):
 *   - comma-separated, UTF-8 (a byte-order mark is allowed), one header row;
 *   - columns are found by header name, not by position, and the unit is part
 *     of the header ("Weight(kg)"); another unit is an unsupported file;
 *   - the date is 14 digits, yyyymmddhhmmss, the local time on the device;
 *   - a value the device did not measure is "-".
 *
 * This module has no dependencies and uses relative imports only: it is bundled
 * into the inbody-import Edge Function (Deno), which is the authority. Nothing
 * here stores, logs or forwards the CSV text.
 */

export const INBODY_CSV_MAX_BYTES = 256 * 1024
export const INBODY_CSV_MAX_ROWS = 500

/** Why a file was refused. Each code has one user-facing message. */
export type InbodyCsvProblem =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'NOT_CSV'
  | 'UNSUPPORTED_FORMAT'
  | 'MISSING_COLUMNS'
  | 'NO_MEASUREMENTS'
  | 'INVALID_DATE'
  | 'INVALID_VALUE'
  | 'NO_METRICS'

export class InbodyCsvError extends Error {
  readonly problem: InbodyCsvProblem
  /** The column or row concerned, for the message. Never a value from the file. */
  readonly detail: string | null

  constructor(problem: InbodyCsvProblem, detail: string | null = null) {
    super(`InBody CSV refused: ${problem}`)
    this.name = 'InbodyCsvError'
    this.problem = problem
    this.detail = detail
  }
}

export interface InbodyOtherMetric {
  label: string
  value: number
  unit: string | null
}

/** One measurement (one CSV row), validated. `null` = not measured. */
export interface ParsedInbodyMeasurement {
  /** ISO date (YYYY-MM-DD) as printed by the device. */
  measurementDate: string
  /** Local date and time on the device, "YYYY-MM-DDTHH:MM:SS" (no timezone). */
  measuredAt: string
  device: string | null
  weightKg: number | null
  bodyFatPercent: number | null
  muscleMassKg: number | null
  bmi: number | null
  bmrKcal: number | null
  /** Further values kept with the result (inbody_metrics.other_metrics_json). */
  otherMetrics: Record<string, InbodyOtherMetric>
}

interface Range {
  min: number
  max: number
}

/** The same ranges as the inbody_metrics CHECK constraints. */
export const INBODY_RANGES = {
  weightKg: { min: 20, max: 400 },
  bodyFatPercent: { min: 0, max: 100 },
  muscleMassKg: { min: 0, max: 200 },
  bmi: { min: 5, max: 100 },
  bmrKcal: { min: 500, max: 5000 },
} as const satisfies Record<string, Range>

type CoreField = keyof typeof INBODY_RANGES

/** "Weight(kg)" → "weight(kg)"; "BMI(kg/m²)" → "bmi(kg/m2)". */
export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\.$/, '')
}

const DATE_HEADER = 'date'
const DEVICE_HEADER = 'measurementdevice'

/**
 * The columns stored in dedicated inbody_metrics columns. "Muscle mass" is
 * InBody's Skeletal Muscle Mass, the muscle figure on the result sheet.
 */
const CORE_COLUMNS: Record<CoreField, { header: string; label: string }> = {
  weightKg: { header: 'weight(kg)', label: 'Weight' },
  muscleMassKg: { header: 'skeletalmusclemass(kg)', label: 'Skeletal Muscle Mass' },
  bodyFatPercent: { header: 'percentbodyfat(%)', label: 'Percent Body Fat' },
  bmi: { header: 'bmi(kg/m2)', label: 'BMI' },
  bmrKcal: { header: 'basalmetabolicrate(kcal)', label: 'Basal Metabolic Rate' },
}

/** Whole-body values kept as additional metrics. Segmental values are not kept. */
const OTHER_COLUMNS: Record<
  string,
  { header: string; label: string; unit: string | null; max: number }
> = {
  body_fat_mass_kg: { header: 'bodyfatmass(kg)', label: 'Body fat mass', unit: 'kg', max: 300 },
  soft_lean_mass_kg: { header: 'softleanmass(kg)', label: 'Soft lean mass', unit: 'kg', max: 300 },
  total_body_water_l: {
    header: 'totalbodywater(l)',
    label: 'Total body water',
    unit: 'L',
    max: 200,
  },
  protein_kg: { header: 'protein(kg)', label: 'Protein', unit: 'kg', max: 100 },
  mineral_kg: { header: 'mineral(kg)', label: 'Mineral', unit: 'kg', max: 50 },
  visceral_fat_level: {
    header: 'visceralfatlevel(level)',
    label: 'Visceral fat level',
    unit: null,
    max: 60,
  },
  visceral_fat_area_cm2: {
    header: 'visceralfatarea(cm2)',
    label: 'Visceral fat area',
    unit: 'cm²',
    max: 1000,
  },
  waist_hip_ratio: { header: 'waisthipratio', label: 'Waist–hip ratio', unit: null, max: 3 },
  smi_kg_m2: { header: 'smi(kg/m2)', label: 'Skeletal muscle index', unit: 'kg/m²', max: 50 },
  inbody_score: { header: 'inbodyscore', label: 'InBody score', unit: null, max: 200 },
}

/** A header whose name we know but whose unit is not the one we store. */
const UNIT_SENSITIVE = /^(weight|skeletalmusclemass|softleanmass|bodyfatmass)\((?!kg\))/

/**
 * Splits CSV text into rows of fields (RFC 4180: quoted fields, doubled quotes,
 * commas and line breaks inside quotes). Throws on an unterminated quote.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false
  const endField = () => {
    row.push(field)
    field = ''
    afterQuote = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
          afterQuote = true
        }
      } else field += char
    } else if (char === '"' && field.trim() === '' && !afterQuote) {
      field = ''
      quoted = true
    } else if (char === ',') endField()
    else if (char === '\n') endRow()
    else if (char === '\r') {
      if (text[index + 1] === '\n') index += 1
      endRow()
    } else if (afterQuote && char !== ' ' && char !== '\t') {
      throw new InbodyCsvError('NOT_CSV')
    } else if (!afterQuote) field += char
  }
  if (quoted) throw new InbodyCsvError('NOT_CSV')
  if (field !== '' || row.length > 0 || afterQuote) endRow()
  return rows.filter((fields) => fields.some((value) => value.trim() !== ''))
}

const MISSING = new Set(['', '-', '--'])

/** A plain decimal number or null for "not measured". Anything else is invalid. */
function numberOrNull(raw: string, column: string): number | null {
  const value = raw.trim()
  if (MISSING.has(value)) return null
  // No thousands separators, no decimal commas, no units inside the value.
  if (!/^\d{1,6}(\.\d{1,4})?$/.test(value)) throw new InbodyCsvError('INVALID_VALUE', column)
  return Number(value)
}

function inRange(value: number | null, range: Range, column: string): number | null {
  if (value !== null && (value < range.min || value > range.max)) {
    throw new InbodyCsvError('INVALID_VALUE', column)
  }
  return value
}

function parseTimestamp(raw: string): { date: string; at: string } {
  const value = raw.trim()
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!match) throw new InbodyCsvError('INVALID_DATE')
  const [, y, m, d, hh, mm, ss] = match
  const date = `${String(y)}-${String(m)}-${String(d)}`
  // Reject impossible calendar dates and times (2026-02-30, 25:61:00).
  const check = new Date(`${date}T00:00:00Z`)
  if (
    Number.isNaN(check.getTime()) ||
    check.toISOString().slice(0, 10) !== date ||
    Number(y) < 2000 ||
    Number(hh) > 23 ||
    Number(mm) > 59 ||
    Number(ss) > 59
  ) {
    throw new InbodyCsvError('INVALID_DATE')
  }
  return { date, at: `${date}T${String(hh)}:${String(mm)}:${String(ss)}` }
}

/** True when the bytes cannot be a text CSV (binary data, another encoding). */
export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096)
  // UTF-16 byte-order marks, and control characters that never occur in CSV text.
  if (
    sample.length >= 2 &&
    ((sample[0] === 0xff && sample[1] === 0xfe) || (sample[0] === 0xfe && sample[1] === 0xff))
  ) {
    return true
  }
  return sample.some((byte) => byte === 0 || byte < 0x09 || (byte > 0x0d && byte < 0x20))
}

/**
 * Parses an InBody CSV export into validated measurements, newest first.
 * Throws InbodyCsvError; never returns a partly understood file.
 */
export function parseInbodyCsv(text: string): ParsedInbodyMeasurement[] {
  if (text.length > INBODY_CSV_MAX_BYTES) throw new InbodyCsvError('TOO_LARGE')
  const content = text.replace(/^\uFEFF/, '')
  if (content.trim() === '') throw new InbodyCsvError('EMPTY')

  const rows = parseCsvRows(content)
  const header = rows[0]
  if (!header) throw new InbodyCsvError('EMPTY')
  if (header.length < 2) {
    // One column usually means another delimiter (semicolon or tab).
    throw new InbodyCsvError(/[;\t]/.test(header[0] ?? '') ? 'UNSUPPORTED_FORMAT' : 'NOT_CSV')
  }

  const columns = new Map<string, number>()
  header.forEach((name, index) => {
    const key = normalizeHeader(name)
    if (key === '') return
    // The same column twice makes the file ambiguous.
    if (columns.has(key)) throw new InbodyCsvError('UNSUPPORTED_FORMAT', name.trim())
    columns.set(key, index)
  })

  const otherUnit = [...columns.keys()].find((key) => UNIT_SENSITIVE.test(key))
  if (otherUnit) throw new InbodyCsvError('UNSUPPORTED_FORMAT', otherUnit)
  if (!columns.has(DATE_HEADER)) {
    throw new InbodyCsvError(
      Object.values(CORE_COLUMNS).some((column) => columns.has(column.header))
        ? 'MISSING_COLUMNS'
        : 'UNSUPPORTED_FORMAT',
      'Date',
    )
  }
  const missing = Object.values(CORE_COLUMNS).filter((column) => !columns.has(column.header))
  if (missing.length === Object.keys(CORE_COLUMNS).length)
    throw new InbodyCsvError('UNSUPPORTED_FORMAT')
  if (missing.length > 0) {
    throw new InbodyCsvError('MISSING_COLUMNS', missing.map((column) => column.label).join(', '))
  }

  const body = rows.slice(1)
  if (body.length === 0) throw new InbodyCsvError('NO_MEASUREMENTS')
  if (body.length > INBODY_CSV_MAX_ROWS) throw new InbodyCsvError('TOO_LARGE')

  const cell = (row: string[], key: string) => {
    const index = columns.get(key)
    return index === undefined ? '' : (row[index] ?? '')
  }

  const measurements = body.map((row): ParsedInbodyMeasurement => {
    // A row with more fields than the header is not this format.
    if (row.length > header.length) throw new InbodyCsvError('NOT_CSV')
    const { date, at } = parseTimestamp(cell(row, DATE_HEADER))
    const core = (field: CoreField) =>
      inRange(
        numberOrNull(cell(row, CORE_COLUMNS[field].header), CORE_COLUMNS[field].label),
        INBODY_RANGES[field],
        CORE_COLUMNS[field].label,
      )

    const bmr = core('bmrKcal')
    const otherMetrics: Record<string, InbodyOtherMetric> = {}
    for (const [key, column] of Object.entries(OTHER_COLUMNS)) {
      if (!columns.has(column.header)) continue
      const value = inRange(
        numberOrNull(cell(row, column.header), column.label),
        { min: 0, max: column.max },
        column.label,
      )
      if (value !== null) otherMetrics[key] = { label: column.label, value, unit: column.unit }
    }
    const device = cell(row, DEVICE_HEADER).trim()
    const measurement: ParsedInbodyMeasurement = {
      measurementDate: date,
      measuredAt: at,
      device: /^[\w .-]{1,40}$/.test(device) ? device : null,
      weightKg: core('weightKg'),
      bodyFatPercent: core('bodyFatPercent'),
      muscleMassKg: core('muscleMassKg'),
      bmi: core('bmi'),
      // The database stores BMR as a whole number of kcal.
      bmrKcal: bmr === null ? null : Math.round(bmr),
      otherMetrics,
    }
    if (
      measurement.weightKg === null &&
      measurement.bodyFatPercent === null &&
      measurement.muscleMassKg === null
    ) {
      throw new InbodyCsvError('NO_METRICS')
    }
    return measurement
  })

  const seen = new Set<string>()
  for (const measurement of measurements) {
    // Two rows for the same moment would make "which one?" a guess.
    if (seen.has(measurement.measuredAt)) throw new InbodyCsvError('UNSUPPORTED_FORMAT', 'Date')
    seen.add(measurement.measuredAt)
  }
  return measurements.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))
}

/** One user-facing sentence per refusal; never the file's content. */
export const INBODY_CSV_MESSAGES: Record<InbodyCsvProblem, string> = {
  EMPTY: 'The file is empty.',
  TOO_LARGE: 'The file is too large for an InBody CSV export.',
  NOT_CSV: 'This file is not a valid CSV file.',
  UNSUPPORTED_FORMAT:
    'Unsupported InBody CSV format. Use the CSV exported from the InBody app (values in kg).',
  MISSING_COLUMNS: 'Required InBody metrics could not be found in this CSV.',
  NO_MEASUREMENTS: 'The CSV has no measurements.',
  INVALID_DATE: 'Measurement date could not be found or is not valid.',
  INVALID_VALUE: 'One or more values are invalid.',
  NO_METRICS: 'Required InBody metrics could not be found in this CSV.',
}
