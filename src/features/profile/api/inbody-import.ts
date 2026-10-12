import { FunctionsHttpError } from '@supabase/supabase-js'

import { isNetworkError, NETWORK_ERROR_MESSAGE } from '@/lib/errors/network-error'
import type { AppSupabaseClient } from '@/lib/supabase/client'

import {
  INBODY_CSV_MAX_BYTES,
  INBODY_CSV_MESSAGES,
  type InbodyCsvProblem,
  looksBinary,
} from '../lib/inbody-csv'

/*
 * InBody CSV import (spec §21). The browser only reads the file's text and
 * sends it to the inbody-import Edge Function, which parses and validates it
 * and, after the user's confirmation, stores the result. No metric value is
 * ever submitted from here: saving sends the same file again and the server
 * reads the values from it.
 */

/** A report awaiting results that a measurement may be attached to. */
export interface InbodyImportReport {
  id: string
  date: string
  sameDate: boolean
}

/** One measurement of the CSV, as read by the server, for the user to review. */
export interface InbodyCsvMeasurement {
  measuredAt: string
  date: string
  weightKg: number | null
  bodyFatPercent: number | null
  muscleMassKg: number | null
  bmi: number | null
  bmrKcal: number | null
  other: { label: string; value: number; unit: string | null }[]
  /** Dated after today: cannot be saved. */
  future: boolean
  /** Results for this date already exist: cannot be saved again. */
  hasResults: boolean
  reports: InbodyImportReport[]
}

export interface InbodyCsvFile {
  filename: string
  csv: string
}

type ImportCode =
  | 'NOT_CSV_FILE'
  | 'INVALID_CSV'
  | 'FUTURE_DATE'
  | 'MEASUREMENT_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'ALREADY_HAS_RESULTS'
  | 'DATE_MISMATCH'
  | 'PENDING_REPORT_EXISTS'
  | 'RESULTS_EXIST_FOR_DATE'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'NETWORK'
  | 'SERVER_ERROR'

const MESSAGES: Record<ImportCode, string> = {
  NOT_CSV_FILE: 'Choose the CSV file exported from the InBody app (.csv).',
  INVALID_CSV: INBODY_CSV_MESSAGES.UNSUPPORTED_FORMAT,
  FUTURE_DATE: 'The measurement date can’t be in the future.',
  MEASUREMENT_NOT_FOUND: 'That measurement is not in this CSV. Choose the file again.',
  REPORT_NOT_FOUND: 'That report is no longer available.',
  ALREADY_HAS_RESULTS:
    'This report already has results. They can’t be replaced; ask an admin if a value needs correcting.',
  DATE_MISMATCH: 'This CSV does not match the selected report.',
  PENDING_REPORT_EXISTS:
    'A report for this date is awaiting results. Import the CSV into that report.',
  RESULTS_EXIST_FOR_DATE:
    'InBody results for this date already exist. They can’t be replaced; ask an admin if a value needs correcting.',
  FORBIDDEN: 'Your account can’t import InBody results.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again.',
  NETWORK: NETWORK_ERROR_MESSAGE,
  SERVER_ERROR: 'Couldn’t import the CSV. Please try again.',
}

/** A refused import. `message` is safe to show; it never contains file content. */
export class InbodyImportError extends Error {
  readonly code: ImportCode
  readonly problem: InbodyCsvProblem | null

  constructor(code: ImportCode, problem: InbodyCsvProblem | null = null) {
    super(problem ? INBODY_CSV_MESSAGES[problem] : MESSAGES[code])
    this.name = 'InbodyImportError'
    this.code = code
    this.problem = problem
  }
}

/** Plain text for a failed import. */
export function inbodyImportMessage(error: unknown): string {
  if (error instanceof InbodyImportError) return error.message
  return isNetworkError(error) ? NETWORK_ERROR_MESSAGE : MESSAGES.SERVER_ERROR
}

/**
 * Reads the chosen file as text after the checks that need no server: the
 * extension (a browser's MIME type for CSV is unreliable), the size and that
 * it is UTF-8 text. The server repeats every check.
 */
export async function readInbodyCsvFile(file: File): Promise<InbodyCsvFile> {
  if (!/\.csv$/i.test(file.name)) throw new InbodyImportError('NOT_CSV_FILE')
  if (file.size === 0) throw new InbodyImportError('INVALID_CSV', 'EMPTY')
  if (file.size > INBODY_CSV_MAX_BYTES) throw new InbodyImportError('INVALID_CSV', 'TOO_LARGE')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (looksBinary(bytes)) throw new InbodyImportError('INVALID_CSV', 'NOT_CSV')
  let csv: string
  try {
    csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new InbodyImportError('INVALID_CSV', 'NOT_CSV')
  }
  if (csv.trim() === '') throw new InbodyImportError('INVALID_CSV', 'EMPTY')
  return { filename: file.name.slice(-255), csv }
}

async function invoke<T>(supabase: AppSupabaseClient, body: object): Promise<T> {
  const response = await supabase.functions.invoke<T>('inbody-import', { body })
  const error: unknown = response.error
  if (error) {
    let code: ImportCode = isNetworkError(error) ? 'NETWORK' : 'SERVER_ERROR'
    let problem: InbodyCsvProblem | null = null
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = (await (error.context as Response).json()) as {
          error?: unknown
          problem?: unknown
        }
        if (typeof payload.error === 'string' && payload.error in MESSAGES) {
          code = payload.error as ImportCode
        }
        if (typeof payload.problem === 'string' && payload.problem in INBODY_CSV_MESSAGES) {
          problem = payload.problem as InbodyCsvProblem
        }
      } catch {
        // keep the generic code
      }
    }
    throw new InbodyImportError(code, code === 'INVALID_CSV' ? problem : null)
  }
  if (response.data === null) throw new InbodyImportError('SERVER_ERROR')
  return response.data
}

interface ParseResponse {
  measurements: {
    measured_at: string
    date: string
    weight_kg: number | null
    body_fat_percent: number | null
    muscle_mass_kg: number | null
    bmi: number | null
    bmr_kcal: number | null
    other: { label: string; value: number; unit: string | null }[]
    future: boolean
    has_results: boolean
    reports: { id: string; date: string; same_date: boolean }[]
  }[]
}

/** Has the server parse and validate the CSV. Nothing is stored. */
export async function parseInbodyCsvFile(
  supabase: AppSupabaseClient,
  file: InbodyCsvFile,
): Promise<InbodyCsvMeasurement[]> {
  const data = await invoke<ParseResponse>(supabase, { action: 'parse', ...file })
  return data.measurements.map((row) => ({
    measuredAt: row.measured_at,
    date: row.date,
    weightKg: row.weight_kg,
    bodyFatPercent: row.body_fat_percent,
    muscleMassKg: row.muscle_mass_kg,
    bmi: row.bmi,
    bmrKcal: row.bmr_kcal,
    other: row.other,
    future: row.future,
    hasResults: row.has_results,
    reports: row.reports.map((report) => ({
      id: report.id,
      date: report.date,
      sameDate: report.same_date,
    })),
  }))
}

export interface InbodyImportInput {
  file: InbodyCsvFile
  /** Which measurement of the file to save. */
  measuredAt: string
  /** The report to attach to, or null to record the CSV as a report of its own. */
  reportId: string | null
}

/** Saves one measurement of the CSV after the user confirmed it. */
export async function saveInbodyCsv(
  supabase: AppSupabaseClient,
  input: InbodyImportInput,
): Promise<{ reportDate: string }> {
  const data = await invoke<{ result: { report_date: string } }>(supabase, {
    action: 'save',
    ...input.file,
    measured_at: input.measuredAt,
    report_id: input.reportId,
  })
  return { reportDate: data.result.report_date }
}
