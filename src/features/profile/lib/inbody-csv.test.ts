import { describe, expect, it } from 'vitest'

import {
  INBODY_CSV_MAX_BYTES,
  InbodyCsvError,
  type InbodyCsvProblem,
  looksBinary,
  normalizeHeader,
  parseCsvRows,
  parseInbodyCsv,
} from './inbody-csv'
import { INBODY_CSV_HEADER, inbodyCsv, inbodyCsvRow } from './inbody-csv.fixture'

function problemOf(text: string): InbodyCsvProblem | 'PARSED' {
  try {
    parseInbodyCsv(text)
    return 'PARSED'
  } catch (error) {
    if (error instanceof InbodyCsvError) return error.problem
    throw error
  }
}

const csv = (...rows: string[]) => [INBODY_CSV_HEADER, ...rows].join('\n')

describe('parseInbodyCsv: a valid InBody app export', () => {
  it('reads the measurement, mapped by header name', () => {
    const [measurement, ...rest] = parseInbodyCsv(inbodyCsv('20261012073015'))
    expect(rest).toHaveLength(0)
    expect(measurement).toMatchObject({
      measurementDate: '2026-10-12',
      measuredAt: '2026-10-12T07:30:15',
      device: '570',
      weightKg: 81.5,
      bodyFatPercent: 21,
      muscleMassKg: 36.4,
      bmi: 25.2,
      bmrKcal: 1761,
    })
  })

  it('keeps further whole-body values with name, value and unit, and skips unmeasured ones', () => {
    const [measurement] = parseInbodyCsv(inbodyCsv('20261012073015'))
    expect(measurement?.otherMetrics).toEqual({
      body_fat_mass_kg: { label: 'Body fat mass', value: 17.1, unit: 'kg' },
      total_body_water_l: { label: 'Total body water', value: 47.2, unit: 'L' },
      protein_kg: { label: 'Protein', value: 12.8, unit: 'kg' },
      mineral_kg: { label: 'Mineral', value: 4.41, unit: 'kg' },
      visceral_fat_level: { label: 'Visceral fat level', value: 7, unit: null },
      smi_kg_m2: { label: 'Skeletal muscle index', value: 8.6, unit: 'kg/m²' },
      inbody_score: { label: 'InBody score', value: 78, unit: null },
    })
  })

  it('does not depend on column order', () => {
    const headers = INBODY_CSV_HEADER.split(',')
    const cells = inbodyCsvRow('20261012073015').split(',')
    const order = headers.map((_, index) => index).reverse()
    const shuffled = [
      order.map((index) => headers[index]).join(','),
      order.map((index) => cells[index]).join(','),
    ].join('\n')
    expect(parseInbodyCsv(shuffled)).toEqual(parseInbodyCsv(inbodyCsv('20261012073015')))
  })

  it('accepts CRLF line endings, surrounding whitespace and quoted fields', () => {
    const row = inbodyCsvRow('20261012073015', {
      'Weight(kg)': ' 81.5 ',
      'Percent Body Fat(%)': '"21.0"',
    })
    const header = `"Date", Measurement device. ,${INBODY_CSV_HEADER.split(',').slice(2).join(',')}`
    expect(parseInbodyCsv(`${header}\r\n${row}\r\n`)[0]).toMatchObject({
      weightKg: 81.5,
      bodyFatPercent: 21,
    })
  })

  it('returns several measurements newest first', () => {
    const dates = parseInbodyCsv(inbodyCsv('20260901080000', '20261012073015', '20260712190000'))
    expect(dates.map((measurement) => measurement.measurementDate)).toEqual([
      '2026-10-12',
      '2026-09-01',
      '2026-07-12',
    ])
  })

  it('stores a missing optional value as null, never as zero', () => {
    const [measurement] = parseInbodyCsv(
      csv(inbodyCsvRow('20261012073015', { 'BMI(kg/m²)': '-', 'Basal Metabolic Rate(kcal)': '' })),
    )
    expect(measurement).toMatchObject({ bmi: null, bmrKcal: null, weightKg: 81.5 })
  })

  it('rounds a decimal BMR to whole kcal', () => {
    const [measurement] = parseInbodyCsv(
      csv(inbodyCsvRow('20261012073015', { 'Basal Metabolic Rate(kcal)': '1760.6' })),
    )
    expect(measurement?.bmrKcal).toBe(1761)
  })
})

describe('parseInbodyCsv: refusals', () => {
  const valid = inbodyCsv('20261012073015')
  const row = (overrides: Record<string, string>) => csv(inbodyCsvRow('20261012073015', overrides))

  it.each<[string, string, InbodyCsvProblem]>([
    ['an empty file', '', 'EMPTY'],
    ['only a byte-order mark and whitespace', '\uFEFF \n', 'EMPTY'],
    ['a header without measurements', INBODY_CSV_HEADER, 'NO_MEASUREMENTS'],
    ['a file larger than the limit', 'a'.repeat(INBODY_CSV_MAX_BYTES + 1), 'TOO_LARGE'],
    ['plain text', 'hello world', 'NOT_CSV'],
    ['an unterminated quote', `${INBODY_CSV_HEADER}\n"20261012073015,570`, 'NOT_CSV'],
    ['another CSV', 'name,amount\nrice,2', 'UNSUPPORTED_FORMAT'],
    ['a semicolon-separated file', valid.replaceAll(',', ';'), 'UNSUPPORTED_FORMAT'],
    ['weights in pounds', valid.replace('Weight(kg)', 'Weight(lb)'), 'UNSUPPORTED_FORMAT'],
    ['the same column twice', valid.replace('InBody Age', 'Weight(kg)'), 'UNSUPPORTED_FORMAT'],
    [
      'a missing required column',
      valid.replace('Percent Body Fat(%)', 'Something else'),
      'MISSING_COLUMNS',
    ],
    ['a missing date column', valid.replace('Date,', 'When,'), 'MISSING_COLUMNS'],
    ['a date in another format', csv(inbodyCsvRow('2026-10-12 07:30')), 'INVALID_DATE'],
    ['an impossible date', csv(inbodyCsvRow('20260230073015')), 'INVALID_DATE'],
    ['an impossible time', csv(inbodyCsvRow('20261012256100')), 'INVALID_DATE'],
    ['a missing date', csv(inbodyCsvRow('-')), 'INVALID_DATE'],
    ['a value that is not a number', row({ 'Weight(kg)': 'heavy' }), 'INVALID_VALUE'],
    ['a decimal comma', row({ 'Weight(kg)': '"81,5"' }), 'INVALID_VALUE'],
    ['a unit inside the value', row({ 'Weight(kg)': '81.5kg' }), 'INVALID_VALUE'],
    ['a negative value', row({ 'Percent Body Fat(%)': '-3' }), 'INVALID_VALUE'],
    ['a weight outside the stored range', row({ 'Weight(kg)': '500' }), 'INVALID_VALUE'],
    ['a body fat percentage above 100', row({ 'Percent Body Fat(%)': '101' }), 'INVALID_VALUE'],
    [
      'a BMR outside the stored range',
      row({ 'Basal Metabolic Rate(kcal)': '90' }),
      'INVALID_VALUE',
    ],
    ['an invalid additional value', row({ 'Protein(kg)': 'n/a' }), 'INVALID_VALUE'],
    [
      'a row with no weight, body fat or muscle mass',
      row({ 'Weight(kg)': '-', 'Percent Body Fat(%)': '-', 'Skeletal Muscle Mass(kg)': '-' }),
      'NO_METRICS',
    ],
    ['a row with more cells than the header', `${row({})},1`, 'NOT_CSV'],
    [
      'two rows for the same moment',
      inbodyCsv('20261012073015', '20261012073015'),
      'UNSUPPORTED_FORMAT',
    ],
  ])('refuses %s', (_name, text, problem) => {
    expect(problemOf(text)).toBe(problem)
  })

  it('refuses the whole file when one row is invalid', () => {
    expect(
      problemOf(
        csv(inbodyCsvRow('20261012073015'), inbodyCsvRow('20261013073015', { 'Weight(kg)': 'x' })),
      ),
    ).toBe('INVALID_VALUE')
  })
})

describe('CSV helpers', () => {
  it('normalizes headers: case, spaces, superscripts, trailing dot, byte-order mark', () => {
    expect(normalizeHeader('\uFEFFDate')).toBe('date')
    expect(normalizeHeader(' Measurement device. ')).toBe('measurementdevice')
    expect(normalizeHeader('BMI(kg/m²)')).toBe('bmi(kg/m2)')
    expect(normalizeHeader('Percent Body Fat(%)')).toBe('percentbodyfat(%)')
  })

  it('splits rows with quotes, doubled quotes, embedded commas and line breaks', () => {
    expect(parseCsvRows('a,"b,1","say ""hi""","two\nlines"\r\n\r\n1,2,,4')).toEqual([
      ['a', 'b,1', 'say "hi"', 'two\nlines'],
      ['1', '2', '', '4'],
    ])
  })

  it('tells binary content from text', () => {
    expect(looksBinary(new TextEncoder().encode(inbodyCsv('20261012073015')))).toBe(false)
    expect(looksBinary(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]))).toBe(true)
    expect(looksBinary(new Uint8Array([0xff, 0xfe, 0x44, 0x00]))).toBe(true)
  })
})
