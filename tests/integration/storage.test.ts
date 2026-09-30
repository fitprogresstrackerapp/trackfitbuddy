/**
 * The private InBody bucket (spec §21, §65) against the real Storage API:
 * privacy, folder ownership, guessed paths, anonymous access, limits and the
 * report-date rule. Production readiness: the same rules come from migrations.
 */
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  INBODY_BUCKET,
  inbodyReportUrl,
  uploadInbodyReport,
} from '@/features/profile/api/profile-data'
import { addDays } from '@/lib/dates/local-date'

import { adminClient, createUser, env, signedInClient, type BrowserClient } from './helpers.ts'
import { completeProfile, must, TODAY } from './home-fixtures.ts'

const pdf = (bytes = '%PDF-1.4\n%%EOF\n') =>
  new File([bytes], 'scan.pdf', { type: 'application/pdf' })

describe('InBody storage', () => {
  const service = adminClient()
  let owner: BrowserClient
  let other: BrowserClient
  let adminUser: BrowserClient
  let manager: BrowserClient
  let ownerId: string
  let path: string

  beforeAll(async () => {
    const o = await createUser('1111')
    const x = await createUser('2222')
    const a = await createUser('3333', ['ADMIN'])
    const m = await createUser('4444', ['MANAGER'])
    for (const id of [o.userId, x.userId]) await completeProfile(service, id)
    ownerId = o.userId
    owner = await signedInClient(o.phone, o.pin)
    other = await signedInClient(x.phone, x.pin)
    adminUser = await signedInClient(a.phone, a.pin)
    manager = await signedInClient(m.phone, m.pin)
    await uploadInbodyReport(owner, ownerId, { date: TODAY, file: pdf() })
    const report = await must(
      service.from('inbody_reports').select('file_path').eq('user_id', ownerId).single(),
    )
    path = report.file_path
  })

  it('the bucket is private with a size limit and allowed file types', async () => {
    const { data } = await service.storage.getBucket(INBODY_BUCKET)
    expect(data).toMatchObject({ public: false, file_size_limit: 10 * 1024 * 1024 })
    expect(data?.allowed_mime_types).toEqual(
      expect.arrayContaining(['application/pdf', 'image/jpeg', 'image/png']),
    )
  })

  it('the owner reads their report; a signed link works only briefly', async () => {
    expect((await owner.storage.from(INBODY_BUCKET).download(path)).error).toBeNull()
    const url = await inbodyReportUrl(owner, path)
    expect(new URL(url).searchParams.get('token')).toBeTruthy()
    expect((await fetch(url)).status).toBe(200)
  })

  it('another user cannot read, list or sign the report, even with the exact path', async () => {
    expect((await other.storage.from(INBODY_BUCKET).download(path)).data).toBeNull()
    const listed = await other.storage.from(INBODY_BUCKET).list(ownerId)
    expect(listed.data ?? []).toEqual([])
    expect((await other.storage.from(INBODY_BUCKET).createSignedUrl(path, 60)).data).toBeNull()
  })

  it('guessed or traversal paths do not reach another user’s folder', async () => {
    const otherId = (await other.auth.getUser()).data.user?.id ?? ''
    for (const guess of [`${otherId}/../${path}`, `${otherId}/${path.split('/')[1] ?? ''}`]) {
      expect((await other.storage.from(INBODY_BUCKET).download(guess)).data).toBeNull()
    }
    const intrusion = await other.storage
      .from(INBODY_BUCKET)
      .upload(`${ownerId}/planted.pdf`, pdf(), { contentType: 'application/pdf' })
    expect(intrusion.error).not.toBeNull()
  })

  it('anonymous requests get nothing: no download, no public URL', async () => {
    const anon = createClient(env().supabaseUrl, env().anonKey, {
      auth: { persistSession: false },
    })
    expect((await anon.storage.from(INBODY_BUCKET).download(path)).data).toBeNull()
    const publicUrl = anon.storage.from(INBODY_BUCKET).getPublicUrl(path).data.publicUrl
    expect((await fetch(publicUrl)).ok).toBe(false)
    const upload = await anon.storage
      .from(INBODY_BUCKET)
      .upload(`${ownerId}/anon.pdf`, pdf(), { contentType: 'application/pdf' })
    expect(upload.error).not.toBeNull()
  })

  it('admins can read reports; managers cannot read files (not in their scope)', async () => {
    expect((await adminUser.storage.from(INBODY_BUCKET).download(path)).error).toBeNull()
    expect((await manager.storage.from(INBODY_BUCKET).download(path)).data).toBeNull()
  })

  it('oversized files and other file types are rejected', async () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    const tooBig = await owner.storage
      .from(INBODY_BUCKET)
      .upload(`${ownerId}/big.pdf`, big, { contentType: 'application/pdf' })
    expect(tooBig.error).not.toBeNull()
    const html = await owner.storage
      .from(INBODY_BUCKET)
      .upload(`${ownerId}/page.html`, new File(['<script>1</script>'], 'page.html'), {
        contentType: 'text/html',
      })
    expect(html.error).not.toBeNull()
  })

  it('a report dated in the future is rejected', async () => {
    await expect(
      uploadInbodyReport(owner, ownerId, { date: addDays(TODAY, 2), file: pdf() }),
    ).rejects.toMatchObject({ code: '22023' })
  })
})
