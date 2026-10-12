/**
 * InBody CSV import against the real local stack: the inbody-import Edge
 * Function, import_inbody_metrics(), the private bucket, RLS, the weight sync
 * and the recommendation input. Users act through the app's own data functions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  InbodyImportError,
  parseInbodyCsvFile,
  readInbodyCsvFile,
  saveInbodyCsv,
} from '@/features/profile/api/inbody-import'
import {
  fetchInbodyReports,
  fetchWeights,
  INBODY_BUCKET,
  uploadInbodyReport,
} from '@/features/profile/api/profile-data'
import {
  INBODY_CSV_HEADER,
  inbodyCsv,
  inbodyCsvRow,
} from '@/features/profile/lib/inbody-csv.fixture'
import type { RecommendationInput } from '@/features/recommendations/engine/input'
import { addDays } from '@/lib/dates/local-date'
import type { Json } from '@/types/database'

import { adminClient, createUser, env, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, must, run, TODAY } from './home-fixtures.ts'
import {
  attemptsFor,
  callProcessing,
  getSetting,
  makeReady,
  setSetting,
} from './recommendation-fixtures.ts'

const stamp = (date: string, time = '073015') => `${date.replaceAll('-', '')}${time}`
const csvFile = (text: string, name = 'InBody-export.csv') => ({ filename: name, csv: text })
const pdf = () => new File(['%PDF-1.4\n%%EOF\n'], 'scan.pdf', { type: 'application/pdf' })

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'OK'
  } catch (error) {
    if (error instanceof InbodyImportError) return error.problem ?? error.code
    throw error
  }
}

async function call(client: BrowserClient | null, body: unknown, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: env().anonKey,
  }
  const session = client ? (await client.auth.getSession()).data.session : null
  const bearer = token ?? session?.access_token
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const response = await fetch(`${env().supabaseUrl}/functions/v1/inbody-import`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    // non-JSON gateway response
  }
  return { status: response.status, body: payload }
}

describe('InBody CSV import', () => {
  const service = adminClient()
  let ownerId: string
  let owner: BrowserClient
  let otherId: string
  let other: BrowserClient
  let manager: BrowserClient
  let adminSession: BrowserClient
  let noInbodyId: string
  let savedBudget: Json | undefined

  const D5 = addDays(TODAY, -5)
  const D9 = addDays(TODAY, -9)
  const D1 = addDays(TODAY, -1)

  beforeAll(async () => {
    savedBudget = await getSetting(service, 'ai_monthly_budget')
    const o = await createUser('1111')
    const x = await createUser('2222')
    const m = await createUser('3333', ['MANAGER'])
    const a = await createUser('4444', ['ADMIN'])
    const n = await createUser('5555')
    ownerId = o.userId
    otherId = x.userId
    noInbodyId = n.userId
    await makeReady(service, ownerId)
    await makeReady(service, noInbodyId)
    await completeProfile(service, otherId)
    await run(
      service.from('manager_user_assignments').insert({ manager_id: m.userId, user_id: ownerId }),
    )
    owner = await signedInClient(o.phone, o.pin)
    other = await signedInClient(x.phone, x.pin)
    manager = await signedInClient(m.phone, m.pin)
    adminSession = await signedInClient(a.phone, a.pin)
  })

  afterAll(async () => {
    if (savedBudget !== undefined) await setSetting(service, 'ai_monthly_budget', savedBudget)
  })

  describe('access', () => {
    const body = { action: 'parse', filename: 'a.csv', csv: inbodyCsv(stamp(D5)) }

    it('refuses a request without a session', async () => {
      expect((await call(null, body)).status).toBe(401)
    })

    it('refuses an invalid token', async () => {
      const response = await call(null, body, 'not-a-token')
      expect(response.status).toBe(401)
    })

    it('refuses malformed and unexpected input without echoing it', async () => {
      for (const bad of [
        {},
        { action: 'parse', filename: 'a.csv' },
        { action: 'parse', filename: 'a.pdf', csv: 'x' },
        { ...body, user_id: otherId },
        { ...body, action: 'save', measured_at: 'yesterday', report_id: null },
        { ...body, action: 'save', measured_at: `${D5}T07:30:15`, report_id: null, weight_kg: 60 },
      ]) {
        const response = await call(owner, bad)
        expect(response.status).toBe(400)
        expect(response.body).toEqual({ error: 'INVALID_INPUT' })
      }
    })

    it('a browser cannot store results itself: no function, no insert, no status change', async () => {
      const rpc = await owner.rpc('import_inbody_metrics', {
        p_user_id: ownerId,
        p_measurement_date: D5,
        p_other: {},
        p_weight_kg: 60,
      })
      expect(rpc.error).toBeTruthy()
      const report = await must(
        service
          .from('inbody_reports')
          .insert({
            user_id: ownerId,
            report_date: addDays(TODAY, -40),
            file_path: `${ownerId}/direct.pdf`,
            file_type: 'application/pdf',
          })
          .select('id')
          .single(),
      )
      for (const client of [owner, manager]) {
        const insert = await client
          .from('inbody_metrics')
          .insert({ report_id: report.id, user_id: ownerId, weight_kg: 60 })
        expect(insert.error?.code).toBe('42501')
      }
      await owner
        .from('inbody_reports')
        .update({ extraction_status: 'COMPLETED' })
        .eq('id', report.id)
      const after = await must(
        service.from('inbody_reports').select('extraction_status').eq('id', report.id).single(),
      )
      expect(after.extraction_status).toBe('PENDING')
      await run(
        service
          .from('inbody_reports')
          .update({ is_deleted: true, deleted_at: new Date().toISOString() })
          .eq('id', report.id),
      )
    })
  })

  describe('parsing', () => {
    it('reads a browser file: extension, size and text are checked before sending', async () => {
      const good = new File([inbodyCsv(stamp(D5))], 'InBody.CSV', {
        type: 'application/vnd.ms-excel',
      })
      expect((await readInbodyCsvFile(good)).csv).toContain('Weight(kg)')
      expect(await codeOf(readInbodyCsvFile(new File(['a,b'], 'scan.pdf')))).toBe('NOT_CSV_FILE')
      expect(await codeOf(readInbodyCsvFile(new File([], 'empty.csv')))).toBe('EMPTY')
      expect(
        await codeOf(readInbodyCsvFile(new File([new Uint8Array([0x25, 0x50, 0, 1])], 'x.csv'))),
      ).toBe('NOT_CSV')
      expect(
        await codeOf(readInbodyCsvFile(new File([new Uint8Array(300 * 1024).fill(65)], 'x.csv'))),
      ).toBe('TOO_LARGE')
    })

    it('returns the measurement for review and stores nothing', async () => {
      const [measurement, ...rest] = await parseInbodyCsvFile(owner, csvFile(inbodyCsv(stamp(D5))))
      expect(rest).toHaveLength(0)
      expect(measurement).toMatchObject({
        date: D5,
        measuredAt: `${D5}T07:30:15`,
        weightKg: 81.5,
        bodyFatPercent: 21,
        muscleMassKg: 36.4,
        bmi: 25.2,
        bmrKcal: 1761,
        future: false,
        hasResults: false,
        reports: [],
      })
      expect(measurement?.other).toContainEqual({ label: 'Protein', value: 12.8, unit: 'kg' })
      expect(await fetchInbodyReports(owner, ownerId)).toHaveLength(0)
    })

    it.each([
      ['another CSV', 'name,amount\nrice,2', 'UNSUPPORTED_FORMAT'],
      ['a missing column', inbodyCsv(stamp(D5)).replace('Weight(kg)', 'Mass'), 'MISSING_COLUMNS'],
      [
        'an invalid date',
        [INBODY_CSV_HEADER, inbodyCsvRow('12/10/2026')].join('\n'),
        'INVALID_DATE',
      ],
      [
        'an invalid value',
        [INBODY_CSV_HEADER, inbodyCsvRow(stamp(D5), { 'Weight(kg)': 'abc' })].join('\n'),
        'INVALID_VALUE',
      ],
      ['binary content', 'Date,Weight(kg)\n\u0000\u0001', 'NOT_CSV'],
    ])('refuses %s with a problem code only', async (_name, text, problem) => {
      const response = await call(owner, { action: 'parse', filename: 'a.csv', csv: text })
      expect(response.status).toBe(422)
      expect(response.body).toEqual({ error: 'INVALID_CSV', problem })
    })

    it('flags a future measurement and refuses to save it', async () => {
      const future = addDays(TODAY, 2)
      const file = csvFile(inbodyCsv(stamp(future)))
      const [measurement] = await parseInbodyCsvFile(owner, file)
      expect(measurement?.future).toBe(true)
      expect(
        await codeOf(
          saveInbodyCsv(owner, { file, measuredAt: `${future}T07:30:15`, reportId: null }),
        ),
      ).toBe('FUTURE_DATE')
    })
  })

  describe('saving', () => {
    let reportD5: string
    let reportD9: string

    beforeAll(async () => {
      await uploadInbodyReport(owner, ownerId, { date: D5, file: pdf(), today: TODAY })
      await uploadInbodyReport(owner, ownerId, { date: D9, file: pdf(), today: TODAY })
      await uploadInbodyReport(other, otherId, { date: D5, file: pdf(), today: TODAY })
      const reports = await fetchInbodyReports(owner, ownerId)
      reportD5 = reports.find((report) => report.date === D5)?.id ?? ''
      reportD9 = reports.find((report) => report.date === D9)?.id ?? ''
    })

    it('offers the same-date report, and a report one day off, but never another user’s', async () => {
      const file = csvFile(inbodyCsv(stamp(D5), stamp(addDays(D9, 1)), stamp(D1)))
      const parsed = await parseInbodyCsvFile(owner, file)
      expect(parsed.map((item) => [item.date, item.reports])).toEqual([
        [D1, []],
        [D5, [{ id: reportD5, date: D5, sameDate: true }]],
        [addDays(D9, 1), [{ id: reportD9, date: D9, sameDate: false }]],
      ])
    })

    it('does not attach to another user’s report, an unknown report or a report of another date', async () => {
      const file = csvFile(inbodyCsv(stamp(D5)))
      const measuredAt = `${D5}T07:30:15`
      const theirs = (await fetchInbodyReports(other, otherId))[0]?.id ?? ''
      expect(await codeOf(saveInbodyCsv(owner, { file, measuredAt, reportId: theirs }))).toBe(
        'REPORT_NOT_FOUND',
      )
      expect(
        await codeOf(saveInbodyCsv(owner, { file, measuredAt, reportId: crypto.randomUUID() })),
      ).toBe('REPORT_NOT_FOUND')
      expect(await codeOf(saveInbodyCsv(owner, { file, measuredAt, reportId: reportD9 }))).toBe(
        'DATE_MISMATCH',
      )
      // A second record is refused while the uploaded report for that date waits.
      expect(await codeOf(saveInbodyCsv(owner, { file, measuredAt, reportId: null }))).toBe(
        'PENDING_REPORT_EXISTS',
      )
      expect(
        await codeOf(
          saveInbodyCsv(owner, { file, measuredAt: `${D1}T07:30:15`, reportId: reportD5 }),
        ),
      ).toBe('MEASUREMENT_NOT_FOUND')
      const theirReport = await must(
        service.from('inbody_metrics').select('id').eq('user_id', otherId),
      )
      expect(theirReport).toHaveLength(0)
      expect((await fetchInbodyReports(owner, ownerId)).every((report) => !report.metrics)).toBe(
        true,
      )
    })

    it('saves the confirmed measurement to the user’s report, completes it and syncs the weight', async () => {
      const file = csvFile(inbodyCsv(stamp(D5)))
      const saved = await saveInbodyCsv(owner, {
        file,
        measuredAt: `${D5}T07:30:15`,
        reportId: reportD5,
      })
      expect(saved.reportDate).toBe(D5)

      const report = (await fetchInbodyReports(owner, ownerId)).find((item) => item.id === reportD5)
      expect(report).toMatchObject({
        status: 'COMPLETED',
        fileType: 'application/pdf',
        metrics: {
          weightKg: 81.5,
          bodyFatPercent: 21,
          muscleMassKg: 36.4,
          bmi: 25.2,
          bmrKcal: 1761,
        },
      })
      const stored = await must(
        service
          .from('inbody_metrics')
          .select('user_id, other_metrics_json')
          .eq('report_id', reportD5)
          .single(),
      )
      expect(stored.user_id).toBe(ownerId)
      expect(stored.other_metrics_json).toMatchObject({
        source: 'inbody_csv',
        measured_at: `${D5}T07:30:15`,
        metrics: { protein_kg: { label: 'Protein', value: 12.8, unit: 'kg' } },
      })
      const weights = await fetchWeights(owner, ownerId)
      expect(weights.recent.find((weight) => weight.date === D5)).toMatchObject({
        weightKg: 81.5,
        source: 'INBODY',
      })
      // The CSV was not kept: the report still has only its uploaded file.
      const files = await service.storage.from(INBODY_BUCKET).list(ownerId)
      expect(files.data?.some((item) => item.name.endsWith('.csv'))).toBe(false)
    })

    it('never overwrites existing results, including a repeated submission', async () => {
      const changed = csvFile(
        `${INBODY_CSV_HEADER}\n${inbodyCsvRow(stamp(D5), { 'Weight(kg)': '99.9' })}`,
      )
      const measuredAt = `${D5}T07:30:15`
      expect(
        await codeOf(saveInbodyCsv(owner, { file: changed, measuredAt, reportId: reportD5 })),
      ).toBe('ALREADY_HAS_RESULTS')
      expect(
        await codeOf(saveInbodyCsv(owner, { file: changed, measuredAt, reportId: null })),
      ).toBe('RESULTS_EXIST_FOR_DATE')
      const [parsed] = await parseInbodyCsvFile(owner, changed)
      expect(parsed).toMatchObject({ hasResults: true, reports: [] })
      const report = (await fetchInbodyReports(owner, ownerId)).find((item) => item.id === reportD5)
      expect(report?.metrics?.weightKg).toBe(81.5)
    })

    it('records a CSV without a matching report as its own record, once', async () => {
      const file = csvFile(inbodyCsv(stamp(D1)))
      const input = { file, measuredAt: `${D1}T07:30:15`, reportId: null }
      const results = await Promise.all([
        codeOf(saveInbodyCsv(owner, input)),
        codeOf(saveInbodyCsv(owner, input)),
      ])
      expect(results.sort()).toEqual(['OK', 'RESULTS_EXIST_FOR_DATE'])

      const reports = (await fetchInbodyReports(owner, ownerId)).filter((item) => item.date === D1)
      expect(reports).toHaveLength(1)
      expect(reports[0]).toMatchObject({
        status: 'COMPLETED',
        fileType: 'text/csv',
        metrics: { weightKg: 81.5 },
      })
      expect(reports[0]?.filePath.startsWith(`${ownerId}/${D1}-`)).toBe(true)
      // Exactly one CSV is stored, in the owner's private folder.
      const files = await service.storage.from(INBODY_BUCKET).list(ownerId)
      expect(files.data?.filter((item) => item.name.endsWith('.csv'))).toHaveLength(1)
      const stranger = await other.storage.from(INBODY_BUCKET).download(reports[0]?.filePath ?? '')
      expect(stranger.data).toBeNull()
      const mine = await owner.storage.from(INBODY_BUCKET).download(reports[0]?.filePath ?? '')
      expect(await mine.data?.text()).toContain('Weight(kg)')
    })

    it('other users and group members gain nothing; a manager only reads', async () => {
      const seenByOther = await other.from('inbody_metrics').select('id').eq('user_id', ownerId)
      expect(seenByOther.data).toHaveLength(0)
      const seenByManager = await manager.from('inbody_metrics').select('id').eq('user_id', ownerId)
      expect(seenByManager.data).toHaveLength(2)
      // A manager's import only ever concerns the manager's own account.
      const file = csvFile(inbodyCsv(stamp(D9)))
      expect(
        await codeOf(
          saveInbodyCsv(manager, { file, measuredAt: `${D9}T07:30:15`, reportId: reportD9 }),
        ),
      ).toBe('REPORT_NOT_FOUND')
    })
  })

  describe('recommendation input', () => {
    it('includes the imported result, and nothing of the CSV or the file', async () => {
      await setSetting(service, 'ai_monthly_budget', 100000)
      const response = await callProcessing(adminSession, {
        action: 'start',
        mode: 'PROCESS',
        user_ids: [ownerId, noInbodyId],
      })
      expect(response.status).toBe(200)
      expect(response.body.batch).toMatchObject({ success: 2, failed: 0 })

      const [attempt] = await attemptsFor(service, ownerId)
      const input = attempt?.raw_input_json as unknown as RecommendationInput
      // The latest completed result: the measurement of yesterday.
      expect(input.inbody).toEqual({
        date: D1,
        weight_kg: 81.5,
        body_fat_percent: 21,
        muscle_mass_kg: 36.4,
      })
      expect(input.user.current_weight_kg).toBe(81.5)
      expect(input.schema_version).toBe('recommendation-input-v1')
      expect(attempt?.prompt_version).toBe('recommendation-v1')

      const sent = JSON.stringify(attempt?.raw_input_json)
      for (const forbidden of [
        '.csv',
        '.pdf',
        'inbody-reports',
        ownerId,
        'file_path',
        'Skeletal',
        'Weight(kg)',
        'inbody_csv',
        'measured_at',
        'bmr',
        'bmi',
        'base64',
        'http',
      ]) {
        expect(sent.toLowerCase()).not.toContain(forbidden.toLowerCase())
      }
    })

    it('is null for a user without a completed result', async () => {
      const [attempt] = await attemptsFor(service, noInbodyId)
      expect(attempt?.status).toBe('SUCCESS')
      expect((attempt?.raw_input_json as unknown as RecommendationInput).inbody).toBeNull()
    })
  })
})
