import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
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
          extraMigrations.map((name) =>
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
  return { mf, db, send, signIn }
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

async function inquiriesFixture() {
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
})
const inquiries = '/api/admin/inquiries'

test('private inquiry writes require the admin session, CSRF and correct origin and reject invalid dates and ad attribution', async () => {
  const f = await inquiriesFixture()
  try {
    const input = newInquiry()
    assert.equal((await f.send(inquiries)).status, 401)
    assert.equal((await f.send(inquiries, { body: input })).status, 401)
    const { cookie, csrfToken } = await f.signIn()
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
    assert.equal(
      (
        await f.send(inquiries + '/' + input.id, {
          cookie,
          headers,
          method: 'DELETE',
        })
      ).status,
      404,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('inquiry fields are encrypted, POST retries preserve subsequent edits, and optimistic updates prevent lost changes', async () => {
  const f = await inquiriesFixture()
  try {
    const { cookie, csrfToken } = await f.signIn()
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
      assert.deepEqual((await res.json()).item, { ...input, version: 1 })
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
    const ads = await f.send('/api/admin/meta-ads', { cookie: auth.cookie })
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
