import { test } from 'node:test'
import { issueStaffGrant } from './staff-grant-fixture.mjs'
import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

const origin = 'https://jb-admin.test'
const password = 'test-only-admin-password'
const salt = '0123456789abcdef0123456789abcdef'
const verifier = `v1$${salt}$${createHash('sha256')
  .update(salt + ':' + password)
  .digest('hex')}`
const bundle = await build({
  stdin: {
    contents: `import {adminAnalytics} from './worker/admin-analytics.ts';
      export default {fetch(request,env){
        // Force the same stale pre-read that two interleaved new visits can see.
        // The production SQL still runs against an actual Miniflare D1 database.
        if(request.headers.get('X-Test-Stale-Visit')==='1') {
          const db=env.DB;
          env={...env,DB:{
            prepare(sql){
              if(sql==='SELECT * FROM analytics_visits WHERE id=?')
                return {bind(){return {first:async()=>null}}};
              return db.prepare(sql);
            },
            batch(statements){return db.batch(statements)}
          }};
        }
        return adminAnalytics(request,env)
      }}`,
    resolveDir: process.cwd(),
    sourcefile: 'admin-test-entry.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const migration = await readFile(
  'worker/migrations/0004_admin_analytics.sql',
  'utf8',
)

async function fixture(overrides = {}, extraMigrations = []) {
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    bindings: {
      APP_ORIGIN: origin,
      ADMIN_PASSWORD_VERIFIER: verifier,
      ADMIN_ANALYTICS_KEY: 'test-only-key-abcdefghijklmnopqrstuvwxyz0123456789',
      ...overrides,
    },
    d1Databases: ['DB'],
  })
  const db = await mf.getD1Database('DB')
  try {
    await db.batch(
      [
        migration,
        ...(await Promise.all(
          ['0013_staff_access', ...extraMigrations].map((name) =>
            readFile('worker/migrations/' + name + '.sql', 'utf8'),
          ),
        )),
      ]
        .join('\n')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => db.prepare(statement)),
    )
  } catch (error) {
    await mf.dispose()
    throw error
  }
  const send = (
    path,
    {
      cookie,
      headers,
      body,
      method = body === undefined ? 'GET' : 'POST',
    } = {},
  ) =>
    mf.dispatchFetch(origin + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined
          ? {}
          : { Origin: origin, 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
  const signIn = async (options = {}) => {
    const response = await send('/api/admin/login', {
      body: { password },
      ...options,
    })
    assert.equal(response.status, 200)
    return {
      cookie: response.headers.get('Set-Cookie').split(';')[0],
      ...(await response.json()),
    }
  }
  const activate = async () => {
    const response = await send('/api/staff/activate', {
      body: { token: await issueStaffGrant(db) },
    })
    assert.equal(response.status, 200)
    return {
      cookie: response.headers.get('Set-Cookie').split(';')[0],
      ...(await response.json()),
    }
  }
  return { mf, db, send, signIn, activate }
}
const event = (overrides = {}) => ({
  visitId: randomUUID(),
  viewId: randomUUID(),
  menu: 'overview',
  seq: 0,
  phase: 'enter',
  activeMs: 0,
  ...overrides,
})
const cookieFrom = (response) =>
  response.headers.get('Set-Cookie')?.split(';')[0]
const value = (db, sql) => db.prepare(sql).first()

test('운영 기기 링크는 같은 출처에서 한 번만 사용되고, 운영 권한은 방문자 통계와 분리된다', async () => {
  const f = await fixture()
  try {
    const token = await issueStaffGrant(f.db)
    const activate = (t, headers) =>
      f.send('/api/staff/activate', { body: { token: t }, headers })
    assert.equal(
      (await activate(token, { Origin: 'https://unrelated.test' })).status,
      403,
    )
    assert.equal(
      (await activate(await issueStaffGrant(f.db, Date.now() - 1))).status,
      401,
    )
    const pair = await Promise.all([activate(token), activate(token)])
    assert.deepEqual(pair.map((r) => r.status).sort(), [200, 401])
    const accepted = pair.find((r) => r.status === 200)
    const set = accepted.headers.get('Set-Cookie')
    assert.match(set, /^__Host-jbgolf_staff=/)
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'])
      assert.ok(set.includes(attr))
    const cookie = cookieFrom(accepted)
    const { authenticated, csrfToken } = await accepted.json()
    assert.equal(authenticated, true)
    const stored = await value(f.db, 'SELECT * FROM staff_sessions')
    assert.notEqual(stored.session_hash, cookie.split('=')[1])
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM staff_sessions')).n,
      1,
    )
    assert.equal((await f.send('/api/admin/analytics', { cookie })).status, 401)
    assert.equal(
      (
        await f.send('/api/admin/analytics', {
          cookie: cookie.replace('jbgolf_staff', 'jbgolf_admin'),
        })
      ).status,
      401,
    )
    const owner = await f.signIn()
    for (const path of [
      '/api/admin/calendar',
      '/api/admin/calendar/share',
      '/api/admin/inquiries',
    ])
      assert.equal((await f.send(path, { cookie: owner.cookie })).status, 401)
    assert.deepEqual(
      await (
        await f.send('/api/staff/session', { cookie: owner.cookie })
      ).json(),
      { authenticated: false },
    )
    assert.equal(
      (await f.send('/api/analytics/event', { cookie, body: event() })).status,
      204,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      0,
    )
    await f.db
      .prepare('UPDATE staff_sessions SET expires_at=?')
      .bind(Date.now() + 60_000)
      .run()
    const renewed = await f.send('/api/staff/session', { cookie })
    assert.deepEqual(await renewed.json(), { authenticated: true, csrfToken })
    assert.equal(cookieFrom(renewed), cookie)
    assert.ok(
      (await value(f.db, 'SELECT expires_at FROM staff_sessions')).expires_at >
        Date.now() + 30 * 86_400_000,
    )
    const logout = (headers) =>
      f.send('/api/staff/logout', { cookie, body: {}, headers })
    assert.equal(
      (await logout({ 'X-CSRF-Token': owner.csrfToken })).status,
      403,
    )
    assert.equal(
      (
        await logout({
          'X-CSRF-Token': csrfToken,
          Origin: 'https://unrelated.test',
        })
      ).status,
      403,
    )
    assert.match(
      (await logout({ 'X-CSRF-Token': csrfToken })).headers.get('Set-Cookie'),
      /Max-Age=0/,
    )
    assert.deepEqual(
      await (await f.send('/api/staff/session', { cookie })).json(),
      { authenticated: false },
    )
    assert.equal((await activate(token)).status, 401)
  } finally {
    await f.mf.dispose()
  }
})

test('calendar viewer links authorize only the month and thumbnails, rotate, expire and revoke', async () => {
  const f = await fixture({}, [
    '0001_single_instagram',
    '0010_calendar_schedules',
    '0011_calendar_instagram',
    '0012_calendar_share',
    '0014_calendar_links',
    '0016_calendar_brands',
    '0017_instagram_gallery_indexes',
  ])
  try {
    const ownerShare = '/api/admin/calendar/share'
    const month = '/api/calendar/view?month=2028-02'
    const schedule = '/api/admin/calendar/schedules'
    const thumbnail = '/api/calendar/view/thumbnail/90001'
    const { cookie, csrfToken } = await f.activate()
    const headers = { 'X-CSRF-Token': csrfToken }
    const admin = { cookie, headers, body: {} }
    const bearer = (token) => ({
      headers: { Authorization: 'Bearer ' + token },
    })
    const createLink = async () => {
      const response = await f.send(ownerShare, admin)
      assert.equal(response.status, 200)
      const link = await response.json()
      assert.match(link.token, /^[A-Za-z0-9_-]{43}$/)
      assert.ok(
        Math.abs(Date.parse(link.expiresAt) - (Date.now() + 30 * 86400000)) <
          60000,
      )
      return link
    }
    assert.deepEqual(await (await f.send(ownerShare, { cookie })).json(), {
      expiresAt: null,
    })
    assert.equal((await f.send(ownerShare)).status, 401)
    assert.equal((await f.send(ownerShare, { cookie, body: {} })).status, 403)
    assert.equal(
      (
        await f.send(ownerShare, {
          ...admin,
          headers: { ...headers, Origin: 'https://other.test' },
        })
      ).status,
      403,
    )
    assert.equal((await f.send(month, { cookie })).status, 401)
    assert.equal((await f.send(thumbnail)).status, 401)
    const first = await createLink()
    const row = await f.db
      .prepare('SELECT token_digest FROM calendar_read_grant WHERE id=1')
      .first()
    assert.notEqual(row.token_digest, first.token)
    assert.deepEqual(await (await f.send(ownerShare, { cookie })).json(), {
      expiresAt: first.expiresAt,
    })
    assert.equal((await f.send(month + '&token=' + first.token)).status, 401)
    assert.equal(
      (await f.send('/api/admin/inquiries', bearer(first.token))).status,
      401,
    )
    assert.equal(
      (await f.send(schedule, { ...bearer(first.token), body: {} })).status,
      401,
    )
    const plan = {
      id: randomUUID(),
      account: 'jbgolfacademy',
      kind: 'post',
      title: '촬영 예정',
      date: '2028-02-29',
      time: null,
      note: '담당자 작업 메모',
    }
    assert.equal((await f.send(schedule, { ...admin, body: plan })).status, 200)
    // A synthetic cached CDN URL stands in for a signed Instagram thumbnail. No remote service is called.
    await f.db
      .prepare(
        "INSERT INTO calendar_instagram_accounts(account,user_id,encrypted_token,token_expires_at,refreshed_at) VALUES('jbgolfacademy','101','fixture',0,0)",
      )
      .run()
    await f.db
      .prepare(
        "INSERT INTO calendar_instagram_media(id,account,kind,title,date,time,permalink,thumbnail_url,thumbnail_checked_at,seen_at) VALUES('90001','jbgolfacademy','reel','Published','2028-02-01','19:00','https://www.instagram.com/reel/synthetic/','https://test.cdninstagram.com/synthetic.jpg',?,?)",
      )
      .bind(Date.now(), Date.now())
      .run()
    const response = await f.send(month, bearer(first.token))
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Cache-Control'), /no-store/)
    assert.match(
      response.headers.get('Set-Cookie'),
      /Path=\/api\/calendar\/view\/thumbnail\/; HttpOnly; Secure; SameSite=Strict/,
    )
    const view = await response.json()
    assert.equal(view.schedules[0].title, plan.title)
    assert.equal(view.schedules[0].note, '')
    assert.ok(!JSON.stringify(view).includes(plan.note))
    assert.ok(!JSON.stringify(view).includes(first.token))
    assert.deepEqual(
      view.accounts.map((row) => row.status),
      Array(3).fill('setup_required'),
    )
    assert.deepEqual(Object.keys(view.accounts[0]).sort(), [
      'account',
      'lastSyncedAt',
      'status',
    ])
    assert.equal(view.posts[0].thumbnailUrl, thumbnail)
    const latest = '/api/admin/calendar/posts'
    assert.equal((await f.send(latest, bearer(first.token))).status, 401)
    await f.db
      .prepare(
        "UPDATE calendar_schedules SET permalink='https://www.instagram.com/p/synthetic/' WHERE id=?",
      )
      .bind(plan.id)
      .run()
    const staffFeed = await (await f.send(latest, { cookie })).json()
    assert.equal(staffFeed.posts[0].title, 'Published')
    assert.equal(staffFeed.schedules[0].id, plan.id)
    assert.equal(staffFeed.schedules[0].note, plan.note)
    assert.equal(staffFeed.schedules[0].date, plan.date)
    assert.equal(staffFeed.schedules[0].time, plan.time)
    assert.equal(staffFeed.posts[0].date, '2028-02-01')
    const imageCookie = cookieFrom(response)
    const image = await f.send(thumbnail, { cookie: imageCookie })
    assert.equal(image.status, 302)
    assert.match(image.headers.get('Location'), /synthetic\.jpg$/)
    assert.equal(
      (await f.send(ownerShare, { cookie: imageCookie })).status,
      401,
    )
    const second = await createLink()
    assert.notEqual(second.token, first.token)
    assert.equal((await f.send(month, bearer(first.token))).status, 401)
    assert.equal((await f.send(thumbnail, { cookie: imageCookie })).status, 401)
    await f.db.prepare('UPDATE calendar_read_grant SET expires_at=0').run()
    assert.equal((await f.send(month, bearer(second.token))).status, 401)
    const third = await createLink()
    assert.equal(
      (await f.send(ownerShare, { cookie, body: {}, method: 'DELETE' })).status,
      403,
    )
    assert.deepEqual(
      await (await f.send(ownerShare, { ...admin, method: 'DELETE' })).json(),
      { deleted: true },
    )
    assert.equal((await f.send(month, bearer(third.token))).status, 401)
    assert.deepEqual(await (await f.send(ownerShare, { cookie })).json(), {
      expiresAt: null,
    })
  } finally {
    await f.mf.dispose()
  }
})

test('calendar protects executive plans and monthly reads, including all three account schedules', async () => {
  const f = await fixture({}, [
    '0001_single_instagram',
    '0010_calendar_schedules',
    '0011_calendar_instagram',
    '0014_calendar_links',
    '0016_calendar_brands',
  ])
  try {
    const month = '/api/admin/calendar?month=2024-02'
    const schedules = '/api/admin/calendar/schedules'
    assert.equal((await f.send(month)).status, 401)
    assert.equal(
      (await f.send('/api/admin/calendar/instagram/thumbnail/123')).status,
      401,
    )
    const { cookie, csrfToken } = await f.activate()
    const headers = { 'X-CSRF-Token': csrfToken }
    assert.equal(
      (await f.send('/api/admin/calendar?month=2024-13', { cookie })).status,
      400,
    )
    const empty = await (await f.send(month, { cookie })).json()
    assert.deepEqual(empty.schedules, [])
    assert.deepEqual(empty.posts, [])
    assert.deepEqual(empty.accounts.map((row) => row.account).sort(), [
      'jbgolfacademy',
      'jbgolfclub_bundang',
      'jbgolfclub_official',
    ])

    const plan = {
      id: randomUUID(),
      account: 'jbgolfacademy',
      date: '2024-02-29',
      time: null,
      kind: 'post',
      title: '테스트 촬영 일정',
      note: '가상 일정',
    }
    const create = (body, options = {}) =>
      f.send(schedules, { cookie, headers, body, ...options })
    assert.equal((await create(plan, { cookie: undefined })).status, 401)
    assert.equal((await create(plan, { headers: {} })).status, 403)
    assert.equal(
      (
        await create(plan, {
          headers: { ...headers, Origin: 'https://foreign.invalid' },
        })
      ).status,
      403,
    )
    for (const invalid of [
      { date: '2027-02-29' },
      { time: '24:00' },
      { time: '9:00' },
      { title: '   ' },
      { date: '9999-12-31', permalink: 'https://www.instagram.com/p/X/' },
      { note: 'x'.repeat(2001) },
      { kind: 'paid_ad' },
      { account: 'unknown' },
      { permalink: 'https://www.instagram.com/jbgolfclub_bundang/p/X/' },
      { permalink: 'https://notinstagram.com/p/X/' },
      { permalink: 'https://www.instagram.com/reel/X/' },
      { permalink: 'https://www.instagram.com/jbgolfacademy/' },
      { permalink: 'https://www.instagram.com@another.test/p/X/' },
    ]) {
      assert.equal((await create({ ...plan, ...invalid })).status, 400)
    }
    const april = {
      ...plan,
      id: randomUUID(),
      date: '2024-04-01',
      account: 'jbgolfclub_bundang',
      time: '00:00',
    }
    const feb = {
      ...plan,
      id: randomUUID(),
      date: '2024-02-01',
      account: 'jbgolfclub_official',
      time: '23:59',
      kind: 'reel',
      permalink: 'https://www.instagram.com/reel/Synthetic/',
    }
    for (const input of [plan, april, feb]) {
      const res = await create(input)
      assert.equal(res.status, 200)
      assert.deepEqual((await res.json()).item, {
        permalink: null,
        brand: input.account === 'jbgolfacademy' ? 'academy' : 'club',
        branch: input.account === 'jbgolfclub_bundang' ? 'seohyeon' : null,
        ...input,
        version: 1,
      })
    }
    const sharedCopy =
      'https://instagram.com/JBGOLFCLUB_OFFICIAL/reels/Synthetic/?igsh=fixture#discard'
    assert.equal(
      (await create({ ...plan, id: randomUUID(), date: '9999-12-31' })).status,
      200,
    )
    const canonicalRetry = await create({ ...feb, permalink: sharedCopy })
    assert.equal(canonicalRetry.status, 200)
    assert.equal((await canonicalRetry.json()).item.permalink, feb.permalink)
    const duplicate = await create({
      ...feb,
      id: randomUUID(),
      kind: 'post',
      permalink: 'https://www.instagram.com/p/Synthetic/',
    })
    assert.equal(duplicate.status, 409)
    assert.equal(
      (await duplicate.json()).error.code,
      'calendar_duplicate_permalink',
    )
    const editLinked = (data) =>
      f.send(schedules + '/' + feb.id, {
        cookie,
        headers,
        method: 'PUT',
        body: data,
      })
    const { permalink, ...legacyInput } = feb
    assert.equal(
      (await editLinked({ ...legacyInput, date: '9999-12-31', version: 1 }))
        .status,
      409,
    )
    assert.equal(
      (await (await editLinked({ ...legacyInput, version: 1 })).json()).item
        .permalink,
      permalink,
    )
    assert.equal(
      (
        await (
          await editLinked({ ...legacyInput, version: 2, permalink: null })
        ).json()
      ).item.permalink,
      null,
    )
    const res = await f.send(month, { cookie })
    assert.match(res.headers.get('cache-control'), /no-store/)
    const response = await res.json()
    assert.equal(response.month, '2024-02')
    assert.deepEqual(
      response.schedules.map((row) => row.id),
      [feb.id, plan.id],
    )
    assert.equal(
      (await create({ ...plan, title: 'conflicting retry' })).status,
      409,
    )
    const edits = await Promise.all(
      ['변경 A', '변경 B'].map((title) =>
        f.send(schedules + '/' + plan.id, {
          cookie,
          headers,
          method: 'PUT',
          body: { ...plan, title, date: '2024-03-01', version: 1 },
        }),
      ),
    )
    assert.deepEqual(edits.map((x) => x.status).sort(), [200, 409])
    const edited = (await edits.find((x) => x.status === 200).json()).item
    assert.equal(edited.version, 2)
    assert.equal((await (await create(plan)).json()).item.title, edited.title)
    assert.equal(
      (await (await f.send(month, { cookie })).json()).schedules.length,
      1,
    )
    assert.equal(
      (
        await (
          await f.send('/api/admin/calendar?month=2024-03', { cookie })
        ).json()
      ).schedules[0].id,
      plan.id,
    )
    const remove = (version, options = {}) =>
      f.send(schedules + '/' + plan.id, {
        cookie,
        headers,
        method: 'DELETE',
        body: { version },
        ...options,
      })
    assert.equal((await remove(1)).status, 409)
    assert.equal((await remove(2, { headers: {} })).status, 403)
    assert.equal((await remove(2, { cookie: undefined })).status, 401)
    assert.deepEqual(
      await Promise.all([remove(2), remove(2)]).then((pair) =>
        Promise.all(pair.map((r) => r.json())),
      ),
      [{ deleted: true }, { deleted: true }],
    )
    assert.equal((await create(plan)).status, 409)
    assert.equal(
      (
        await f.send(schedules + '/' + plan.id, {
          cookie,
          headers,
          method: 'PUT',
          body: { ...plan, version: 2 },
        })
      ).status,
      404,
    )
    const retired = await f.db
      .prepare('SELECT * FROM calendar_schedules WHERE id=?')
      .bind(plan.id)
      .first()
    for (const [key, val] of Object.entries(retired))
      if (!['id', 'version'].includes(key)) assert.equal(val, null)
    assert.equal(
      (
        await (
          await f.send('/api/admin/calendar?month=2024-04', { cookie })
        ).json()
      ).schedules[0].id,
      april.id,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('brand schedules preserve legacy IDs, links and retries and allow Haus or either club branch without Instagram', async (t) => {
  const f = await fixture({}, [
    '0001_single_instagram',
    '0010_calendar_schedules',
    '0011_calendar_instagram',
    '0014_calendar_links',
  ])
  t.after(() => f.mf.dispose())
  const id = randomUUID()
  const old = {
    account: 'jbgolfclub_official',
    kind: 'reel',
    date: '2024-02-20',
    time: '12:15',
    title: '링크 일정',
    note: '비공개 메모',
    permalink: 'https://www.instagram.com/reel/Old/',
  }
  const fingerprint = createHmac(
    'sha256',
    'test-only-key-abcdefghijklmnopqrstuvwxyz0123456789',
  )
    .update('calendar-create:' + id + ':' + JSON.stringify(old))
    .digest('base64url')
  const oldInsert =
    'INSERT INTO calendar_schedules(id,version,account,kind,day,local_time,title,note,creation_fingerprint,permalink) VALUES(?,3,?,?,?,?,?,?,?,?)'
  const retired = randomUUID()
  await f.db.batch([
    f.db
      .prepare(oldInsert)
      .bind(
        id,
        old.account,
        old.kind,
        old.date,
        old.time,
        old.title,
        old.note,
        fingerprint,
        old.permalink,
      ),
    f.db
      .prepare('INSERT INTO calendar_schedules(id,version) VALUES(?,4)')
      .bind(retired),
  ])
  const sql = await readFile(
    'worker/migrations/0016_calendar_brands.sql',
    'utf8',
  )
  await f.db.batch(
    sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => f.db.prepare(s)),
  )
  const { cookie, csrfToken } = await f.activate()
  const options = { cookie, headers: { 'X-CSRF-Token': csrfToken } }
  const path = '/api/admin/calendar/schedules'
  const create = (body) => f.send(path, { ...options, body })
  const replay = await create({ ...old, id })
  assert.equal(replay.status, 200)
  assert.deepEqual((await replay.json()).item, {
    ...old,
    id,
    version: 3,
    brand: 'club',
    branch: null,
  })
  assert.equal((await create({ ...old, id: retired })).status, 409)
  const late = randomUUID()
  await f.db
    .prepare(oldInsert)
    .bind(
      late,
      'jbgolfclub_bundang',
      'post',
      old.date,
      null,
      '기존 클라이언트',
      '메모',
      'legacy-grant',
      null,
    )
    .run()
  assert.deepEqual(
    await f.db
      .prepare('SELECT brand,branch FROM calendar_schedules WHERE id=?')
      .bind(late)
      .first(),
    { brand: 'club', branch: 'seohyeon' },
  )
  await f.db
    .prepare("UPDATE calendar_schedules SET account='jbgolfacademy' WHERE id=?")
    .bind(late)
    .run()
  assert.deepEqual(
    await f.db
      .prepare('SELECT brand,branch FROM calendar_schedules WHERE id=?')
      .bind(late)
      .first(),
    { brand: 'academy', branch: null },
  )

  const plan = {
    id: randomUUID(),
    account: null,
    kind: 'post',
    date: '2030-04-08',
    time: null,
    title: '새 일정',
    note: '업무 메모',
    brand: 'haus',
    branch: null,
  }
  for (const invalid of [
    { brand: 'club', branch: null },
    { brand: 'club', branch: 'other' },
    { brand: 'other' },
    { brand: 'academy', branch: 'cheongdam' },
    { brand: 'haus', account: 'jbgolfacademy' },
    { date: old.date, permalink: 'https://www.instagram.com/p/Haus/' },
    { brand: null, account: null },
  ])
    assert.equal((await create({ ...plan, ...invalid })).status, 400)
  const added = await create(plan)
  assert.equal(added.status, 200)
  assert.deepEqual((await added.json()).item, {
    ...plan,
    permalink: null,
    version: 1,
  })
  for (const [index, branch] of ['cheongdam', 'seohyeon'].entries()) {
    const changed = await f.send(path + '/' + plan.id, {
      ...options,
      method: 'PUT',
      body: { ...plan, brand: 'club', branch, version: index + 1 },
    })
    assert.equal(changed.status, 200)
    assert.deepEqual((await changed.json()).item, {
      ...plan,
      brand: 'club',
      branch,
      permalink: null,
      version: index + 2,
    })
  }
  assert.equal((await (await create(plan)).json()).item.branch, 'seohyeon')
  const allSchedules = () =>
    f.db.prepare('SELECT * FROM calendar_schedules ORDER BY id').all()
  const { results: beforeMigration } = await allSchedules()
  for (const migrationName of [
    '0017_instagram_gallery_indexes',
    '0018_calendar_schedule_kinds',
  ]) {
    const migrationSql = await readFile(
      'worker/migrations/' + migrationName + '.sql',
      'utf8',
    )
    await f.db.batch(
      migrationSql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => f.db.prepare(s)),
    )
  }
  assert.deepEqual((await allSchedules()).results, beforeMigration)
  const scheduleIndexes = (
    await f.db.prepare("PRAGMA index_list('calendar_schedules')").all()
  ).results
  for (const index of [
    'calendar_schedules_day',
    'calendar_schedule_link',
    'calendar_link_account_latest',
  ])
    assert.ok(
      scheduleIndexes.some(({ name }) => name === index),
      index,
    )
  assert.equal((await create({ ...old, id: retired })).status, 409)
  assert.equal((await (await create(plan)).json()).item.version, 3)
  assert.equal((await create({ ...plan, brand: 'academy' })).status, 409)
  assert.equal(
    (
      await f.send(path + '/' + plan.id, {
        ...options,
        method: 'DELETE',
        body: { version: 3 },
      })
    ).status,
    200,
  )
  const tombstone = await f.db
    .prepare('SELECT * FROM calendar_schedules WHERE id=?')
    .bind(plan.id)
    .first()
  for (const [key, val] of Object.entries(tombstone))
    if (!['id', 'version'].includes(key)) assert.equal(val, null)

  const work = { ...plan, id: randomUUID(), kind: 'shoot' }
  const shoot = await create(work)
  assert.equal(shoot.status, 200)
  assert.equal((await shoot.json()).item.kind, 'shoot')
  let version = 1
  for (const kind of ['upload_blog', 'upload_post', 'upload_reel', 'shoot']) {
    const edited = await f.send(path + '/' + work.id, {
      ...options,
      method: 'PUT',
      body: { ...work, kind, version },
    })
    assert.equal(edited.status, 200)
    assert.equal((await edited.json()).item.kind, kind)
    version++
  }
  assert.equal((await create({ ...work, kind: 'upload' })).status, 400)
  assert.equal(
    (await create({ ...old, kind: 'upload_reel', id: randomUUID() })).status,
    400,
  )
})

async function inquiriesFixture({ legacy = false } = {}) {
  return fixture(
    {
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      META_AD_ACCOUNT_ID: '1234',
    },
    [
      '0002_reviewed_performance',
      '0005_meta_ads',
      '0006_meta_ad_registry',
      '0008_inquiries',
      ...(legacy
        ? []
        : ['0009_inquiry_branches', '0015_inquiry_customer_type']),
    ],
  )
}
const newInquiry = () => ({
  id: randomUUID(),
  firstDate: null,
  product: 'camp',
  channel: 'kakao',
  source: 'unknown',
  adId: null,
  stage: 'received',
  assignee: 'unassigned',
  name: '',
  contact: '',
  note: '',
  nextAction: '',
  branch: null,
})
const inquiries = '/api/admin/inquiries'

test('private inquiry writes require a staff session, CSRF and correct origin and reject invalid dates and ad attribution', async () => {
  const f = await inquiriesFixture()
  try {
    const input = newInquiry()
    assert.equal((await f.send(inquiries)).status, 401)
    assert.equal((await f.send(inquiries, { body: input })).status, 401)
    const { cookie, csrfToken } = await f.activate()
    const headers = { 'X-CSRF-Token': csrfToken }
    const write = (body) => f.send(inquiries, { cookie, headers, body })
    assert.equal((await f.send(inquiries, { cookie, body: input })).status, 403)
    assert.equal(
      (
        await f.send(inquiries, {
          cookie,
          headers: { ...headers, Origin: 'https://foreign.invalid' },
          body: input,
        })
      ).status,
      403,
    )
    for (const override of [
      { id: 'bad' },
      { firstDate: '2026-02-29' },
      { product: 'bad' },
      { branch: 'unknown-branch' },
      { customerType: 'unknown-type' },
      { source: 'search', adId: 'test-ad' },
      { note: 'a'.repeat(1501) },
      { source: 'instagram_ad', adId: 'unregistered' },
    ])
      assert.equal((await write({ ...input, ...override })).status, 400)
    assert.equal(
      (await write({ ...input, note: 'x'.repeat(16385) })).status,
      400,
    )
    await f.db
      .prepare("INSERT INTO reviewed_ads(id,data) VALUES ('test-ad','{}')")
      .run()
    const added = await write({
      ...input,
      source: 'instagram_ad',
      adId: 'test-ad',
      firstDate: '2024-02-29',
    })
    assert.equal(added.status, 200)
    assert.equal((await added.json()).item.adId, 'test-ad')
    const list = await f.send(inquiries, { cookie })
    assert.match(list.headers.get('Cache-Control'), /no-store/)
    assert.equal((await list.json()).items.length, 1)
  } finally {
    await f.mf.dispose()
  }
})

test('branch migration preserves an existing inquiry, legacy creates can retry and legacy edits retain the assigned branch', async () => {
  const f = await inquiriesFixture({ legacy: true })
  try {
    const { id, branch: _branch, ...originalFields } = newInquiry()
    const legacyFingerprint = createHmac(
      'sha256',
      'test-only-key-abcdefghijklmnopqrstuvwxyz0123456789',
    )
      .update('inquiry-create:' + id + ':' + JSON.stringify(originalFields))
      .digest('base64url')
    await f.db
      .prepare(
        'INSERT INTO inquiries(id,product,channel,creation_fingerprint) VALUES (?,?,?,?)',
      )
      .bind(
        id,
        originalFields.product,
        originalFields.channel,
        legacyFingerprint,
      )
      .run()
    const migrationSql = (
      await Promise.all(
        ['0009_inquiry_branches', '0015_inquiry_customer_type'].map((name) =>
          readFile('worker/migrations/' + name + '.sql', 'utf8'),
        ),
      )
    ).join('\n')
    await f.db.batch(
      migrationSql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => f.db.prepare(s)),
    )
    const { cookie, csrfToken } = await f.activate()
    const options = { cookie, headers: { 'X-CSRF-Token': csrfToken } }
    const create = (body) => f.send(inquiries, { ...options, body })
    const update = (version, fields) =>
      f.send(inquiries + '/' + id, {
        ...options,
        method: 'PUT',
        body: { ...originalFields, version, ...fields },
      })
    const migrated = (await (await f.send(inquiries, { cookie })).json())
      .items[0]
    assert.deepEqual(migrated, {
      id,
      ...originalFields,
      version: 1,
      branch: null,
      customerType: null,
    })
    assert.equal((await create({ id, ...originalFields })).status, 200)
    assert.equal(
      (await create({ id, ...originalFields, branch: null })).status,
      200,
    )
    let version = 1
    for (const branch of ['hanam', 'cheongdam', 'seohyeon']) {
      const edited = (await (await update(version, { branch })).json()).item
      assert.equal(edited.branch, branch)
      version = edited.version
    }
    const legacyEdit = (
      await (await update(version, { stage: 'consulting' })).json()
    ).item
    assert.equal(legacyEdit.branch, 'seohyeon')
    assert.equal(
      (await (await update(legacyEdit.version, { branch: null })).json()).item
        .branch,
      null,
    )
    const newId = randomUUID()
    assert.equal(
      (
        await (
          await create({ id: newId, ...originalFields, branch: 'hanam' })
        ).json()
      ).item.branch,
      'hanam',
    )
    assert.equal(
      (await create({ id: newId, ...originalFields, branch: 'cheongdam' }))
        .status,
      409,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('customer type can change without erasing hidden follow-up notes or breaking older clients', async (t) => {
  const f = await inquiriesFixture()
  t.after(() => f.mf.dispose())
  const { cookie, csrfToken } = await f.activate()
  const options = { cookie, headers: { 'X-CSRF-Token': csrfToken } }
  const record = {
    ...newInquiry(),
    branch: 'hanam',
    nextAction: 'previously saved step',
  }
  const path = inquiries + '/' + record.id
  const create = (body) => f.send(inquiries, { ...options, body })
  const update = (body) => f.send(path, { ...options, method: 'PUT', body })
  assert.equal((await create(record)).status, 200)
  const { nextAction, ...visible } = record
  const changed = await (
    await update({ ...visible, customerType: 'junior', version: 1 })
  ).json()
  assert.equal(changed.item.customerType, 'junior')
  assert.equal(changed.item.nextAction, nextAction)
  const replay = await (await create(record)).json()
  assert.deepEqual(replay.item, changed.item)
  const oldEdit = await (await update({ ...record, version: 2 })).json()
  assert.equal(oldEdit.item.customerType, 'junior')
  const adult = await (
    await update({ ...visible, customerType: 'adult', version: 3 })
  ).json()
  assert.equal(adult.item.customerType, 'adult')
  assert.equal(adult.item.nextAction, nextAction)
  const clear = await (
    await update({ ...visible, customerType: null, version: 4 })
  ).json()
  assert.equal(clear.item.customerType, null)
  assert.equal(clear.item.nextAction, nextAction)
  assert.equal(
    JSON.stringify(
      await f.db
        .prepare('SELECT * FROM inquiries WHERE id=?')
        .bind(record.id)
        .first(),
    ).includes(nextAction),
    false,
  )
  const fresh = { ...visible, id: randomUUID(), customerType: 'adult' }
  const freshItem = (await (await create(fresh)).json()).item
  assert.equal(freshItem.customerType, 'adult')
  assert.equal(freshItem.nextAction, '')
  assert.equal((await create({ ...fresh, customerType: 'junior' })).status, 409)
})

test('only an authorized versioned delete removes an inquiry; repeated delete and delayed create cannot restore it', async () => {
  const f = await inquiriesFixture()
  try {
    const { cookie, csrfToken } = await f.activate()
    const headers = { 'X-CSRF-Token': csrfToken }
    const options = { cookie, headers }
    const input = {
      ...newInquiry(),
      branch: 'cheongdam',
      contact: 'synthetic-only',
    }
    const create = () => f.send(inquiries, { ...options, body: input })
    assert.equal((await create()).status, 200)
    const other = newInquiry()
    assert.equal(
      (await f.send(inquiries, { ...options, body: other })).status,
      200,
    )
    const path = inquiries + '/' + input.id
    const remove = (version, overrides = {}) =>
      f.send(path, {
        ...options,
        method: 'DELETE',
        body: { version },
        ...overrides,
      })
    assert.equal((await remove(1, { cookie: undefined })).status, 401)
    assert.equal((await remove(1, { headers: {} })).status, 403)
    assert.equal(
      (
        await remove(1, {
          headers: { ...headers, Origin: 'https://foreign.invalid' },
        })
      ).status,
      403,
    )
    for (const version of [0, '1', null])
      assert.equal((await remove(version)).status, 400)
    const edited = await f.send(path, {
      ...options,
      method: 'PUT',
      body: { ...input, version: 1, stage: 'consulting' },
    })
    assert.equal((await edited.json()).item.version, 2)
    assert.equal((await remove(1)).status, 409)
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS count FROM deleted_inquiry_ids')
          .first()
      ).count,
      0,
    )
    const pair = await Promise.all([remove(2), remove(2)])
    for (const response of pair) {
      assert.equal(response.status, 200)
      assert.match(response.headers.get('Cache-Control'), /no-store/)
      assert.deepEqual(await response.json(), { deleted: true })
    }
    assert.equal((await create()).status, 409)
    assert.deepEqual(
      (await f.db.prepare('SELECT * FROM deleted_inquiry_ids').all()).results,
      [{ id: input.id }],
    )
    assert.equal(
      await f.db
        .prepare('SELECT * FROM inquiries WHERE id=?')
        .bind(input.id)
        .first(),
      null,
    )
    const { items } = await (await f.send(inquiries, { cookie })).json()
    assert.deepEqual(
      items.map((item) => item.id),
      [other.id],
    )
  } finally {
    await f.mf.dispose()
  }
})

test('inquiry fields are encrypted, POST retries preserve subsequent edits, and optimistic updates prevent lost changes', async () => {
  const f = await inquiriesFixture()
  try {
    const { cookie, csrfToken } = await f.activate()
    const headers = { 'X-CSRF-Token': csrfToken }
    const input = {
      ...newInquiry(),
      name: 'synthetic-name',
      contact: 'synthetic-contact',
      note: 'synthetic-note',
      nextAction: 'synthetic-action',
    }
    const create = (body = input) =>
      f.send(inquiries, { cookie, headers, body })
    const pair = await Promise.all([create(), create()])
    for (const res of pair)
      assert.deepEqual((await res.json()).item, {
        ...input,
        version: 1,
        customerType: null,
      })
    const stored = await f.db
      .prepare('SELECT * FROM inquiries WHERE id=?')
      .bind(input.id)
      .first()
    for (const text of [
      input.name,
      input.contact,
      input.note,
      input.nextAction,
    ])
      assert.equal(JSON.stringify(stored).includes(text), false)
    assert.match(stored.private_fields, /^v1\./)
    const update = (data) =>
      f.send(inquiries + '/' + input.id, {
        cookie,
        headers,
        method: 'PUT',
        body: { ...input, version: 1, ...data },
      })
    const results = await Promise.all([
      update({ stage: 'consulting' }),
      update({ assignee: 'kim_yeoul' }),
    ])
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
    const updated = (
      await results.find((result) => result.status === 200).json()
    ).item
    assert.equal(updated.version, 2)
    assert.deepEqual((await (await create()).json()).item, updated)
    assert.equal(
      (await create({ ...input, contact: 'other-synthetic' })).status,
      409,
    )
    assert.equal((await update({ stage: 'closed' })).status, 409)
    const seed = randomUUID()
    await f.db
      .prepare(
        'INSERT INTO inquiries(id,created_at,product,channel) VALUES (?,?,?,?)',
      )
      .bind(seed, Date.now() + 1, 'lesson', 'phone')
      .run()
    const items = (await (await f.send(inquiries, { cookie })).json()).items
    assert.deepEqual(
      items.map((item) => item.id),
      [seed, input.id],
    )
    assert.deepEqual(items[0], {
      ...newInquiry(),
      id: seed,
      version: 1,
      product: 'lesson',
      channel: 'phone',
      customerType: null,
    })
    assert.deepEqual(items[1], updated)
    assert.equal(
      (
        await f.send(inquiries + '/' + randomUUID(), {
          cookie,
          headers,
          method: 'PUT',
          body: { ...input, version: 1 },
        })
      ).status,
      404,
    )
    // Ciphertext copied to another row must not be accepted as that inquiry's private fields.
    await f.db
      .prepare('UPDATE inquiries SET private_fields=? WHERE id=?')
      .bind(stored.private_fields, seed)
      .run()
    assert.equal((await f.send(inquiries, { cookie })).status, 503)
  } finally {
    await f.mf.dispose()
  }
})

test('관리자 정보는 비인증에 비공개이며 세션·CSRF·로그아웃·만료를 검증한다', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.send('/api/admin/analytics')).status, 401)
    assert.equal((await f.send('/api/admin/meta-ads')).status, 401)
    assert.deepEqual(await (await f.send('/api/admin/session')).json(), {
      configured: true,
      authenticated: false,
    })
    assert.equal(
      (
        await f.send('/api/admin/login', {
          body: { password: 'wrong-test-password' },
        })
      ).status,
      401,
    )
    const auth = await f.signIn()
    assert.equal(auth.configured, true)
    assert.equal(auth.authenticated, true)
    assert.equal(auth.csrfToken.length, 43)
    assert.equal(
      (await f.send('/api/admin/meta-ads', { cookie: auth.cookie })).status,
      401,
    )
    const staff = await f.activate()
    const ads = await f.send('/api/admin/meta-ads', { cookie: staff.cookie })
    assert.equal(ads.status, 200)
    assert.match(ads.headers.get('Cache-Control'), /no-store/)
    assert.equal((await ads.json()).status, 'unconfigured')
    const rawSession = (
      await f.db.prepare('SELECT * FROM admin_sessions').all()
    ).results[0]
    assert.notEqual(rawSession.session_hash, auth.cookie.split('=')[1])
    assert.equal(
      (await f.send('/api/admin/analytics', { cookie: auth.cookie })).status,
      200,
    )
    assert.equal(
      (await f.send('/api/admin/logout', { cookie: auth.cookie, body: {} }))
        .status,
      403,
    )
    const logout = await f.send('/api/admin/logout', {
      cookie: auth.cookie,
      body: {},
      headers: { 'X-CSRF-Token': auth.csrfToken },
    })
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/)
    assert.equal(
      (await f.send('/api/admin/analytics', { cookie: auth.cookie })).status,
      401,
    )
    const again = await f.signIn()
    await f.db.prepare('UPDATE admin_sessions SET expires_at=0').run()
    assert.equal(
      (await f.send('/api/admin/analytics', { cookie: again.cookie })).status,
      401,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('교차 출처·비JSON·큰 요청을 거절하고 로그인 추측 시도를 제한한다', async () => {
  const f = await fixture()
  try {
    assert.equal(
      (
        await f.send('/api/admin/login', {
          body: { password },
          headers: { Origin: 'https://other.test' },
        })
      ).status,
      403,
    )
    for (const contentType of ['text/plain', 'application/jsonevil'])
      assert.equal(
        (
          await f.send('/api/admin/login', {
            body: { password },
            headers: { 'Content-Type': contentType },
          })
        ).status,
        400,
      )
    assert.equal(
      (await f.send('/api/admin/login', { body: 'x'.repeat(2500) })).status,
      400,
    )
    for (let index = 0; index < 5; index++)
      assert.equal(
        (
          await f.send('/api/admin/login', {
            body: { password: 'bad' },
            headers: { 'CF-Connecting-IP': '192.0.2.9' },
          })
        ).status,
        401,
      )
    const blocked = await f.send('/api/admin/login', {
      body: { password },
      headers: { 'CF-Connecting-IP': '192.0.2.9' },
    })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('Retry-After'), '900')
    const limits = await f.db
      .prepare('SELECT rate_key FROM analytics_rate_limits')
      .all()
    assert.ok(
      limits.results.every((row) => !row.rate_key.includes('192.0.2.9')),
    )
    await f.db
      .prepare('UPDATE analytics_rate_limits SET window_started=0')
      .run()
    const auth = await f.signIn({
      headers: { 'CF-Connecting-IP': '192.0.2.9' },
    })
    assert.equal(auth.authenticated, true)
    assert.equal(
      (await f.send('/api/admin/analytics?days=90', { cookie: auth.cookie }))
        .status,
      400,
    )
    assert.equal(
      (await f.send('/api/admin/analytics?page=0', { cookie: auth.cookie }))
        .status,
      400,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('방문과 메뉴 체류를 익명으로 보관하고 중복·역순 이벤트를 중복 집계하지 않는다', async () => {
  const f = await fixture()
  try {
    const start = event()
    const response = await f.send('/api/analytics/event', {
      body: start,
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0 Desktop' },
    })
    assert.equal(response.status, 204)
    assert.match(
      response.headers.get('Set-Cookie'),
      /HttpOnly; Secure; SameSite=Lax/,
    )
    const visitorCookie = cookieFrom(response)
    await f.db
      .prepare('UPDATE analytics_views SET entered_at=entered_at-20000')
      .run()
    await f.db
      .prepare('UPDATE analytics_visits SET started_at=started_at-20000')
      .run()
    for (const next of [
      { seq: 1, phase: 'heartbeat', activeMs: 6000 },
      { seq: 2, phase: 'pause', activeMs: 7000 },
      { seq: 1, phase: 'heartbeat', activeMs: 6500 },
      { seq: 2, phase: 'pause', activeMs: 7000 },
      { seq: 3, phase: 'resume', activeMs: 7000 },
      { seq: 4, phase: 'leave', activeMs: 8000 },
    ])
      assert.equal(
        (
          await f.send('/api/analytics/event', {
            cookie: visitorCookie,
            body: { ...start, ...next },
          })
        ).status,
        204,
      )
    const stored = await value(f.db, 'SELECT * FROM analytics_views')
    assert.equal(stored.active_ms, 8000)
    assert.equal(stored.last_seq, 4)
    assert.equal(stored.is_active, 0)
    assert.ok(stored.ended_at)
    const auth = await f.signIn()
    const report = await (
      await f.send('/api/admin/analytics?days=1', { cookie: auth.cookie })
    ).json()
    assert.equal(report.totalVisits, 1)
    assert.equal(report.totalVisitors, 1)
    assert.equal(report.totalActiveMs, 8000)
    assert.match(report.visits[0].visitorLabel, /^방문자 /)
    assert.equal(report.visits[0].browser, 'Chrome')
    assert.equal(report.visits[0].device, '데스크톱')
    assert.equal(report.visits[0].views[0].menu, 'overview')
    assert.equal(report.visits[0].status, 'ended')
    assert.equal(report.visits[0].activeMs, 8000)
    assert.ok(!JSON.stringify(report).includes(visitorCookie))
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_views')).n,
      1,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('다른 방문자·메뉴로 기록을 탈취하거나 불가능한 체류를 주입할 수 없다', async () => {
  const f = await fixture()
  try {
    const start = event()
    const response = await f.send('/api/analytics/event', { body: start })
    const cookie = cookieFrom(response)
    assert.equal(
      (await f.send('/api/analytics/event', { body: { ...start, seq: 1 } }))
        .status,
      409,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...start, menu: 'blog', seq: 1 },
        })
      ).status,
      409,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...start, visitId: randomUUID(), seq: 1 },
        })
      ).status,
      409,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...start, activeMs: 3_600_000, seq: 1 },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...start, activeMs: -1, seq: 1 },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...start, menu: 'admin', seq: 1 },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...start, viewId: 'bad-id', seq: 1 },
        })
      ).status,
      400,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      1,
    )
    assert.equal(
      (await value(f.db, 'SELECT active_ms AS n FROM analytics_views')).n,
      0,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('기존 메뉴 종료가 늦게 와도 새 메뉴를 종료로 오인하지 않고 마지막 활동만 추정한다', async () => {
  const f = await fixture()
  try {
    const first = event()
    const cookie = cookieFrom(
      await f.send('/api/analytics/event', { body: first }),
    )
    const next = { ...first, viewId: randomUUID(), menu: 'connection' }
    assert.equal(
      (await f.send('/api/analytics/event', { cookie, body: next })).status,
      204,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie,
          body: { ...first, phase: 'leave', seq: 1 },
        })
      ).status,
      204,
    )
    const auth = await f.signIn()
    let report = await (
      await f.send('/api/admin/analytics', { cookie: auth.cookie })
    ).json()
    assert.equal(report.visits[0].status, 'active')
    assert.equal(report.visits[0].endedAt, null)
    await f.db
      .prepare('UPDATE analytics_views SET last_seen_at=last_seen_at-90000')
      .run()
    report = await (
      await f.send('/api/admin/analytics', { cookie: auth.cookie })
    ).json()
    assert.equal(report.visits[0].status, 'idle')
    assert.equal(report.visits[0].endedAt, null)
    assert.ok(report.visits[0].views.some((view) => view.menu === 'connection'))
  } finally {
    await f.mf.dispose()
  }
})

test('관리자 자신의 방문은 제외하고 개인정보 선호와 미설정 상태를 존중한다', async () => {
  const f = await fixture()
  try {
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          body: event(),
          headers: { 'Sec-GPC': '1' },
        })
      ).status,
      204,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      0,
    )
    const visitorCookie = cookieFrom(
      await f.send('/api/analytics/event', { body: event() }),
    )
    const auth = await f.signIn({ cookie: visitorCookie })
    const report = await (
      await f.send('/api/admin/analytics', { cookie: auth.cookie })
    ).json()
    assert.equal(report.totalVisits, 0)
    assert.equal(report.totalVisitors, 0)
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie: auth.cookie + '; ' + visitorCookie,
          body: event(),
        })
      ).status,
      204,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      1,
    )
  } finally {
    await f.mf.dispose()
  }
  const empty = await fixture({ ADMIN_PASSWORD_VERIFIER: '' })
  try {
    assert.deepEqual(await (await empty.send('/api/admin/session')).json(), {
      configured: false,
      authenticated: false,
    })
    assert.equal(
      (await empty.send('/api/admin/login', { body: { password } })).status,
      503,
    )
  } finally {
    await empty.mf.dispose()
  }
})

test('30일 지난 방문만 정리하며 관리자 세션 쿠키는 서버 검증·보호 속성을 사용한다', async () => {
  const f = await fixture()
  try {
    const old = event()
    await f.send('/api/analytics/event', { body: old })
    await f.db
      .prepare('UPDATE analytics_visits SET started_at=started_at-?')
      .bind(31 * 86400000)
      .run()
    await f.db
      .prepare('UPDATE analytics_visitors SET last_seen_at=last_seen_at-?')
      .bind(31 * 86400000)
      .run()
    await f.send('/api/analytics/event', { body: event() })
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      1,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_views')).n,
      1,
    )
    assert.equal(
      (
        await f.send('/api/admin/analytics', {
          cookie: '__Host-jbgolf_admin=' + 'x'.repeat(43),
        })
      ).status,
      401,
    )
    const signedIn = await f.send('/api/admin/login', { body: { password } })
    assert.match(
      signedIn.headers.get('Set-Cookie'),
      /HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=28800/,
    )
    const payload = await signedIn.json()
    assert.ok(!JSON.stringify(payload).includes(password))
    assert.ok(!JSON.stringify(payload).includes(verifier))
  } finally {
    await f.mf.dispose()
  }
})

test('동시 요청의 오래된 사전 조회도 다른 방문자의 방문에 메뉴 기록을 붙이지 못한다', async () => {
  const f = await fixture()
  try {
    const first = event()
    const firstCookie = cookieFrom(
      await f.send('/api/analytics/event', { body: first }),
    )
    const otherCookie = cookieFrom(
      await f.send('/api/analytics/event', { body: event() }),
    )
    const foreignViewId = randomUUID()
    const response = await f.send('/api/analytics/event', {
      cookie: otherCookie,
      headers: { 'X-Test-Stale-Visit': '1' },
      body: { ...first, viewId: foreignViewId, menu: 'blog' },
    })
    assert.equal(response.status, 204)
    assert.equal(
      await f.db
        .prepare('SELECT id FROM analytics_views WHERE id=?')
        .bind(foreignViewId)
        .first(),
      null,
    )
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM analytics_views WHERE visit_id=?')
          .bind(first.visitId)
          .first()
      ).n,
      1,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie: firstCookie,
          body: { ...first, seq: 1, phase: 'heartbeat' },
        })
      ).status,
      204,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('관리자 조회도 30일 지난 방문과 연결된 메뉴를 정리한다', async () => {
  const f = await fixture()
  try {
    await f.send('/api/analytics/event', { body: event() })
    await f.db
      .prepare('UPDATE analytics_visits SET started_at=started_at-?')
      .bind(31 * 86400000)
      .run()
    await f.db
      .prepare('UPDATE analytics_visitors SET last_seen_at=last_seen_at-?')
      .bind(31 * 86400000)
      .run()
    const auth = await f.signIn()
    const report = await (
      await f.send('/api/admin/analytics?days=30', { cookie: auth.cookie })
    ).json()
    assert.equal(report.totalVisits, 0)
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      0,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_views')).n,
      0,
    )
    assert.equal(
      (
        await value(
          f.db,
          'SELECT COUNT(*) AS n FROM analytics_visitors WHERE is_owner=0',
        )
      ).n,
      0,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('직접 관리자 로그인한 새 브라우저도 소유자로 등록하여 로그아웃 이후 방문 집계에서 제외한다', async () => {
  const f = await fixture()
  try {
    const signedIn = await f.send('/api/admin/login', { body: { password } })
    assert.equal(signedIn.status, 200)
    const cookies = signedIn.headers.getSetCookie()
    const adminCookie = cookies
      .find((value) => value.startsWith('__Host-jbgolf_admin='))
      .split(';')[0]
    const visitorCookie = cookies
      .find((value) => value.startsWith('__Host-jbgolf_visitor='))
      .split(';')[0]
    assert.equal(
      (
        await value(
          f.db,
          'SELECT COUNT(*) AS n FROM analytics_visitors WHERE is_owner=1',
        )
      ).n,
      1,
    )
    const auth = await signedIn.json()
    assert.equal(
      (
        await f.send('/api/admin/logout', {
          cookie: adminCookie + '; ' + visitorCookie,
          body: {},
          headers: { 'X-CSRF-Token': auth.csrfToken },
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await f.send('/api/analytics/event', {
          cookie: visitorCookie,
          body: event(),
        })
      ).status,
      204,
    )
    assert.equal(
      (await value(f.db, 'SELECT COUNT(*) AS n FROM analytics_visits')).n,
      0,
    )
  } finally {
    await f.mf.dispose()
  }
})
