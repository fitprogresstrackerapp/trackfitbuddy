/**
 * POST /functions/v1/inbody-import   (the signed-in user, for their own data)
 *
 *   { "action": "parse", "filename": "InBody.csv", "csv": "<file text>" }
 *   { "action": "save",  "filename": "InBody.csv", "csv": "<file text>",
 *     "measured_at": "2026-10-12T07:30:15", "report_id": "<uuid>" | null }
 *
 * InBody CSV import (spec §21). The CSV is parsed here, by the deterministic
 * parser shared with the app's tests (src/features/profile/lib/inbody-csv.ts);
 * no AI model reads it. "parse" returns the measurements for the user to
 * review. "save" parses the same file again and stores the chosen measurement
 * through import_inbody_metrics(): the browser never submits metric values.
 *
 * The user is always the verified caller, never a request field. The CSV is
 * stored only when it becomes a report of its own (no uploaded report to
 * attach to); otherwise it is discarded with the request.
 * Never logged: the request body, the CSV, file names, metric values, tokens.
 */
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  INBODY_CSV_MAX_BYTES,
  InbodyCsvError,
  type ParsedInbodyMeasurement,
  parseInbodyCsv,
} from '../../../src/features/profile/lib/inbody-csv.ts'
import type { Database, Json } from '../../../src/types/database.ts'

type ErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_CSV'
  | 'FUTURE_DATE'
  | 'MEASUREMENT_NOT_FOUND'
  | 'REPORT_NOT_FOUND'
  | 'ALREADY_HAS_RESULTS'
  | 'DATE_MISMATCH'
  | 'PENDING_REPORT_EXISTS'
  | 'RESULTS_EXIST_FOR_DATE'
  | 'SERVER_ERROR'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ALLOWED_ORIGINS = (
  Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://localhost:4173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const BUCKET = 'inbody-reports'
/** A report may be dated one day off the measurement (typed dates, midnight scans). */
const DATE_TOLERANCE_DAYS = 1

const file = {
  // The extension is checked as well as the content: a browser's MIME type for
  // CSV depends on the installed software and proves nothing.
  filename: z
    .string()
    .max(255)
    .regex(/\.csv$/i),
  csv: z.string().min(1).max(INBODY_CSV_MAX_BYTES),
}
const requestSchema = z.union([
  z.strictObject({ action: z.literal('parse'), ...file }),
  z.strictObject({
    action: z.literal('save'),
    ...file,
    measured_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
    report_id: z.uuid().nullable(),
  }),
])

/** SQLSTATEs raised by import_inbody_metrics(). */
const SAVE_ERRORS: Record<string, [ErrorCode, number] | undefined> = {
  IB001: ['REPORT_NOT_FOUND', 404],
  IB002: ['ALREADY_HAS_RESULTS', 409],
  IB003: ['DATE_MISMATCH', 422],
  IB004: ['PENDING_REPORT_EXISTS', 409],
  IB005: ['RESULTS_EXIST_FOR_DATE', 409],
  '42501': ['FORBIDDEN', 403],
}

/** Binary data and other encodings arrive as control or replacement characters. */
function looksLikeText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 0xfffd || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) {
      return false
    }
  }
  return true
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

const fail = (code: ErrorCode, status: number, origin: string | null, extra: object = {}) =>
  json({ error: code, ...extra }, status, origin)

const dayNumber = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000

/** "Today" as a calendar date in the user's own timezone. */
function localDate(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Extra values kept with the result; not part of the AI input. */
function otherMetricsJson(measurement: ParsedInbodyMeasurement): Json {
  return {
    source: 'inbody_csv',
    measured_at: measurement.measuredAt,
    device: measurement.device,
    metrics: Object.fromEntries(
      Object.entries(measurement.otherMetrics).map(([key, metric]) => [key, { ...metric }]),
    ),
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin')
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405, origin)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('inbody-import: missing server configuration')
    return fail('SERVER_ERROR', 500, origin)
  }

  const db = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // The user is the verified caller.
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!token) return fail('UNAUTHENTICATED', 401, origin)
  const { data: auth, error: authError } = await db.auth.getUser(token)
  if (authError || !auth.user) return fail('UNAUTHENTICATED', 401, origin)
  const userId = auth.user.id

  const profile = await db
    .from('profiles')
    .select('is_active, timezone')
    .eq('id', userId)
    .maybeSingle()
  if (profile.error) {
    console.error('inbody-import: profile lookup failed')
    return fail('SERVER_ERROR', 500, origin)
  }
  if (!profile.data?.is_active) return fail('FORBIDDEN', 403, origin)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail('INVALID_INPUT', 400, origin)
  }
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) return fail('INVALID_INPUT', 400, origin)
  const command = parsed.data

  let measurements: ParsedInbodyMeasurement[]
  try {
    if (!looksLikeText(command.csv)) throw new InbodyCsvError('NOT_CSV')
    measurements = parseInbodyCsv(command.csv)
  } catch (error) {
    if (error instanceof InbodyCsvError) {
      return fail('INVALID_CSV', 422, origin, { problem: error.problem })
    }
    console.error('inbody-import: parsing failed')
    return fail('SERVER_ERROR', 500, origin)
  }

  try {
    const today = localDate(profile.data.timezone)

    if (command.action === 'parse') {
      // The user's own reports, to say where each measurement can go.
      const reports = await db
        .from('inbody_reports')
        .select('id, report_date, inbody_metrics(id)')
        .eq('user_id', userId)
        .eq('is_deleted', false)
      if (reports.error) throw new Error('reports lookup')
      const open = reports.data.filter((report) => report.inbody_metrics.length === 0)
      const done = new Set(
        reports.data
          .filter((report) => report.inbody_metrics.length > 0)
          .map((report) => report.report_date),
      )
      return json(
        {
          measurements: measurements.map((measurement) => ({
            measured_at: measurement.measuredAt,
            date: measurement.measurementDate,
            weight_kg: measurement.weightKg,
            body_fat_percent: measurement.bodyFatPercent,
            muscle_mass_kg: measurement.muscleMassKg,
            bmi: measurement.bmi,
            bmr_kcal: measurement.bmrKcal,
            other: Object.values(measurement.otherMetrics),
            future: measurement.measurementDate > today,
            has_results: done.has(measurement.measurementDate),
            // Reports awaiting results that this measurement may be attached to.
            reports: open
              .map((report) => ({
                id: report.id,
                date: report.report_date,
                days: Math.abs(
                  dayNumber(report.report_date) - dayNumber(measurement.measurementDate),
                ),
              }))
              .filter((report) => report.days <= DATE_TOLERANCE_DAYS)
              .sort((a, b) => a.days - b.days)
              .map((report) => ({
                id: report.id,
                date: report.date,
                same_date: report.days === 0,
              })),
          })),
        },
        200,
        origin,
      )
    }

    const measurement = measurements.find((item) => item.measuredAt === command.measured_at)
    if (!measurement) return fail('MEASUREMENT_NOT_FOUND', 422, origin)
    if (measurement.measurementDate > today) return fail('FUTURE_DATE', 422, origin)

    // Without a report to attach to, the CSV becomes the new report's file.
    let filePath: string | null = null
    if (command.report_id === null) {
      filePath = `${userId}/${measurement.measurementDate}-${crypto.randomUUID()}.csv`
      const upload = await db.storage
        .from(BUCKET)
        .upload(filePath, new Blob([command.csv], { type: 'text/csv' }), {
          contentType: 'text/csv',
          upsert: false,
        })
      if (upload.error) throw new Error('csv upload')
    }

    // Missing values are left out: the function's defaults store them as null.
    const saved = await db.rpc('import_inbody_metrics', {
      p_user_id: userId,
      p_measurement_date: measurement.measurementDate,
      p_other: otherMetricsJson(measurement),
      ...(command.report_id ? { p_report_id: command.report_id } : {}),
      ...(filePath ? { p_file_path: filePath } : {}),
      ...(measurement.weightKg !== null ? { p_weight_kg: measurement.weightKg } : {}),
      ...(measurement.bodyFatPercent !== null
        ? { p_body_fat_percent: measurement.bodyFatPercent }
        : {}),
      ...(measurement.muscleMassKg !== null ? { p_muscle_mass_kg: measurement.muscleMassKg } : {}),
      ...(measurement.bmi !== null ? { p_bmi: measurement.bmi } : {}),
      ...(measurement.bmrKcal !== null ? { p_bmr_kcal: measurement.bmrKcal } : {}),
    })
    if (saved.error) {
      // Nothing was saved: do not leave the CSV behind without a report.
      if (filePath) {
        await db.storage
          .from(BUCKET)
          .remove([filePath])
          .catch(() => undefined)
      }
      const known = SAVE_ERRORS[saved.error.code]
      if (known) return fail(known[0], known[1], origin)
      if (saved.error.code === '22023') {
        return fail('INVALID_CSV', 422, origin, { problem: 'INVALID_VALUE' })
      }
      throw new Error('save')
    }
    console.log(
      JSON.stringify({ fn: 'inbody-import', event: 'imported', new_report: filePath !== null }),
    )
    return json({ result: saved.data }, 200, origin)
  } catch {
    console.error('inbody-import: action failed', command.action)
    return fail('SERVER_ERROR', 500, origin)
  }
})
