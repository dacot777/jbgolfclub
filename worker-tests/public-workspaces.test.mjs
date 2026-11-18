import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'
import { issueStaffGrant } from './staff-grant-fixture.mjs'

const origin = 'https://shared-workspaces.test'
const bundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
async function setup(t) {
  const network = createFetchMock()
  network.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    fetchMock: network,
    bindings: {
      APP_ORIGIN: origin,
      ADMIN_ANALYTICS_KEY: 'test-only-key-abcdefghijklmnopqrstuvwxyz0123456789',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
  })
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  for (const name of [
    '0002_reviewed_performance',
    '0004_admin_analytics',
    '0008_inquiries',
    '0009_inquiry_branches',
    '0010_calendar_schedules',
    '0011_calendar_instagram',
    '0013_staff_access',
    '0014_calendar_links',
    '0015_inquiry_customer_type',
    '0016_calendar_brands',
    '0017_instagram_gallery_indexes',
    '0018_calendar_schedule_kinds',
  ]) {
    const sql = await readFile('worker/migrations/' + name + '.sql', 'utf8')
    await db.batch(
      sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    )
  }
  const send = (path, { method, body, headers } = {}) =>
    mf.dispatchFetch(origin + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body === undefined
          ? {}
          : { Origin: origin, 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const staffResponse = await send('/api/staff/activate', {
    body: { token: await issueStaffGrant(db) },
  })
  assert.equal(staffResponse.status, 200)
  const staff = {
    Cookie: staffResponse.headers.get('set-cookie').split(';')[0],
    'X-CSRF-Token': (await staffResponse.json()).csrfToken,
  }
  return { db, send, staff }
}
const inquiry = () => ({
  id: randomUUID(),
  firstDate: '2026-11-18',
  product: 'camp',
  branch: 'hanam',
  channel: 'kakao',
  source: 'unknown',
  adId: null,
  stage: 'received',
  assignee: 'unassigned',
  customerType: 'junior',
  name: 'Fixture customer',
  contact: 'fixture-contact',
  note: 'Private consultation',
  nextAction: 'Legacy follow-up',
})
const plan = () => ({
  id: randomUUID(),
  account: null,
  brand: 'club',
  branch: 'cheongdam',
  kind: 'shoot',
  date: '2026-11-18',
  time: '10:30',
  title: 'Shared filming schedule',
})
function assertRedacted(item) {
  for (const key of ['name', 'contact', 'note', 'nextAction'])
    assert.equal(item[key], '')
  assert.equal(item.adId, null)
  assert.equal(item.customerType, null)
  assert.equal(item.privateFields, undefined)
  assert.equal(item.creationFingerprint, undefined)
}

test('shared inquiry CRUD keeps private details encrypted, preserves them on edits, and handles retries and conflicts', async (t) => {
  const { db, send, staff } = await setup(t)
  const path = '/api/inquiries'
  const input = inquiry()
  const created = await send(path, { body: input })
  assert.equal(created.status, 200)
  const added = (await created.json()).item
  assert.equal(added.version, 1)
  assertRedacted(added)
  const stored = () =>
    db.prepare('SELECT * FROM inquiries WHERE id=?').bind(input.id).first()
  const before = await stored()
  assert.match(before.private_fields, /^v1\./)
  for (const secret of [
    input.name,
    input.contact,
    input.note,
    input.nextAction,
  ])
    assert.ok(!JSON.stringify(before).includes(secret))
  const privateList = await send('/api/admin/inquiries', { headers: staff })
  assert.equal((await privateList.json()).items[0].name, input.name)
  const list = await send(path)
  assert.match(list.headers.get('cache-control'), /no-store/)
  assertRedacted((await list.json()).items[0])
  assert.equal((await send('/api/admin/inquiries')).status, 401)

  const edit = {
    ...added,
    version: 1,
    stage: 'consulting',
    assignee: 'kim_yeoul',
    name: 'Must not overwrite',
    contact: 'replacement',
    note: 'replacement',
    nextAction: 'replacement',
    customerType: 'adult',
    adId: 'replacement',
  }
  const changed = await send(path + '/' + input.id, {
    method: 'PUT',
    body: edit,
  })
  assert.equal(changed.status, 200)
  const edited = (await changed.json()).item
  assert.equal(edited.version, 2)
  assert.equal(edited.stage, 'consulting')
  assertRedacted(edited)
  const after = await stored()
  assert.equal(after.private_fields, before.private_fields)
  assert.equal(after.customer_type, before.customer_type)
  const retry = await send(path, { body: input })
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).item.version, 2)
  assert.equal(
    (await send(path + '/' + input.id, { method: 'PUT', body: edit })).status,
    409,
  )
  assert.equal(
    (
      await send(path + '/' + input.id, {
        method: 'DELETE',
        body: { version: 1 },
      })
    ).status,
    409,
  )
  assert.equal(
    (await send(path, { body: { ...input, name: 'different creation' } }))
      .status,
    409,
  )
  const replay = await send(path, { body: input })
  assertRedacted((await replay.json()).item)
  assert.equal(
    (
      await send(path + '/' + input.id, {
        method: 'DELETE',
        body: { version: 2 },
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await send(path + '/' + input.id, {
        method: 'DELETE',
        body: { version: 2 },
      })
    ).status,
    200,
  )
  assert.equal((await send(path, { body: input })).status, 409)
  assert.deepEqual((await (await send(path)).json()).items, [])
})

test('shared inquiry edits keep linked ads unless the public source changes away from advertising', async (t) => {
  const { db, send } = await setup(t)
  const input = inquiry()
  assert.equal((await send('/api/inquiries', { body: input })).status, 200)
  await db
    .prepare(
      "UPDATE inquiries SET source='instagram_ad',ad_id='private-linked-ad' WHERE id=?",
    )
    .bind(input.id)
    .run()
  const publicItem = (await (await send('/api/inquiries')).json()).items[0]
  assertRedacted(publicItem)
  const url = '/api/inquiries/' + input.id
  assert.equal(
    (
      await send(url, {
        method: 'PUT',
        body: { ...publicItem, stage: 'consulting' },
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await db
        .prepare('SELECT ad_id FROM inquiries WHERE id=?')
        .bind(input.id)
        .first()
    ).ad_id,
    'private-linked-ad',
  )
  assert.equal(
    (
      await send(url, {
        method: 'PUT',
        body: { ...publicItem, version: 2, source: 'referral' },
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await db
        .prepare('SELECT ad_id FROM inquiries WHERE id=?')
        .bind(input.id)
        .first()
    ).ad_id,
    null,
  )
})

test('shared schedules are editable with version checks, keep private notes, and protect published records', async (t) => {
  const { db, send, staff } = await setup(t)
  const path = '/api/calendar/schedules'
  const input = plan()
  const created = await send(path, { body: input })
  assert.equal(created.status, 200)
  assert.equal((await created.json()).item.note, '')
  await db
    .prepare('UPDATE calendar_schedules SET note=? WHERE id=?')
    .bind('Private team instructions', input.id)
    .run()
  const month = await send('/api/calendar?month=2026-11')
  assert.equal(month.status, 200)
  const row = (await month.json()).schedules[0]
  assert.equal(row.version, 1)
  assert.equal(row.note, '')
  const edit = {
    ...input,
    version: 1,
    branch: 'seohyeon',
    kind: 'upload_blog',
    title: 'Changed work',
    note: '',
  }
  const changed = await send(path + '/' + input.id, {
    method: 'PUT',
    body: edit,
  })
  assert.equal(changed.status, 200)
  assert.equal((await changed.json()).item.version, 2)
  const updated = await db
    .prepare('SELECT note,branch,kind FROM calendar_schedules WHERE id=?')
    .bind(input.id)
    .first()
  assert.deepEqual(updated, {
    note: 'Private team instructions',
    branch: 'seohyeon',
    kind: 'upload_blog',
  })
  const replay = await send(path, { body: input })
  assert.equal((await replay.json()).item.note, '')
  assert.equal(
    (await send(path + '/' + input.id, { method: 'PUT', body: edit })).status,
    409,
  )
  assert.equal(
    (
      await send(path + '/' + input.id, {
        method: 'DELETE',
        body: { version: 1 },
      })
    ).status,
    409,
  )
  assert.equal(
    (
      await send(path + '/' + input.id, {
        method: 'DELETE',
        body: { version: 2 },
      })
    ).status,
    200,
  )
  assert.equal((await send(path, { body: input })).status, 409)

  const publication = {
    id: randomUUID(),
    account: 'jbgolfacademy',
    kind: 'post',
    date: '2024-01-01',
    time: null,
    title: 'Published post',
    note: 'Private',
    permalink: 'https://www.instagram.com/p/FixturePost/',
  }
  assert.equal((await send(path, { body: publication })).status, 403)
  assert.equal(
    (
      await send('/api/admin/calendar/schedules', {
        headers: staff,
        body: publication,
      })
    ).status,
    200,
  )
  assert.equal(
    (
      await send(path + '/' + publication.id, {
        method: 'DELETE',
        body: { version: 1 },
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await send(path + '/' + publication.id, {
        method: 'PUT',
        body: { ...input, version: 1 },
      })
    ).status,
    403,
  )
})

test('public writes require same-origin JSON and never grant protected staff or analytics access', async (t) => {
  const { db, send } = await setup(t)
  for (const [path, input] of [
    ['/api/inquiries', inquiry()],
    ['/api/calendar/schedules', plan()],
  ]) {
    assert.equal(
      (
        await send(path, {
          body: input,
          headers: { Origin: 'https://other.test' },
        })
      ).status,
      403,
    )
    assert.equal(
      (await send(path, { body: input, headers: { Origin: '' } })).status,
      403,
    )
    assert.equal(
      (
        await send(path, {
          body: input,
          headers: { 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await send(path, {
          body: input,
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
      400,
    )
    assert.equal((await send(path, { method: 'OPTIONS' })).status, 403)
    assert.equal(
      (
        await send(path + '/' + input.id, {
          method: 'PUT',
          body: { ...input, version: 1 },
          headers: { Origin: 'https://other.test' },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await send(path + '/' + input.id, {
          method: 'DELETE',
          body: { version: 1 },
          headers: { Origin: 'https://other.test' },
        })
      ).status,
      403,
    )
  }
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM inquiries').first()).count,
    0,
  )
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS count FROM calendar_schedules')
        .first()
    ).count,
    0,
  )
  for (const path of [
    '/api/admin/inquiries',
    '/api/admin/calendar?month=2026-11',
    '/api/admin/meta-ads',
  ])
    assert.equal((await send(path)).status, 401)
  assert.equal(
    (
      await send('/api/admin/calendar/instagram/connect/jbgolfacademy', {
        body: {},
      })
    ).status,
    401,
  )
  assert.notEqual((await send('/api/admin/analytics')).status, 200)
  assert.equal((await send('/api/staff/session')).status, 200)
  assert.equal(
    (await (await send('/api/staff/session')).json()).authenticated,
    false,
  )
})
