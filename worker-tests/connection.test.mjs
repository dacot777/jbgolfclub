import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const origin = 'https://jb-golf.test'
const appSecret = 'test-only-instagram-app-secret'
const rawToken = 'test-only-long-lived-instagram-token'
const bundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const migration = await readFile(
  'worker/migrations/0001_single_instagram.sql',
  'utf8',
)

test('큰 숫자 ID를 반올림하지 않고 OAuth ID의 삭제 알림도 같은 계정으로 처리한다', async () => {
  const f = await fixture()
  try {
    const beginning = await f.begin()
    f.fetchMock
      .get('https://api.instagram.com')
      .intercept({ path: '/oauth/access_token', method: 'POST' })
      .reply(
        200,
        '{"access_token":"test-only-short-token","user_id":98765432101234567}',
        { headers: { 'Content-Type': 'application/json' } },
      )
    f.fetchMock
      .get('https://graph.instagram.com')
      .intercept({ path: /^\/access_token\?/, method: 'GET' })
      .reply(200, { access_token: rawToken, expires_in: 5184000 })
    f.fetchMock
      .get('https://graph.instagram.com')
      .intercept({ path: /^\/v26\.0\/me\?/, method: 'GET' })
      .reply(
        200,
        '{"id":98765432101234567,"user_id":17841412345678901,"username":"jb_test_single"}',
        { headers: { 'Content-Type': 'application/json' } },
      )
    assert.match(
      (await f.finish(beginning)).headers.get('Location'),
      /instagram_connected=1/,
    )
    const stored = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    assert.equal(stored.user_id, '17841412345678901')
    assert.equal(stored.oauth_user_id, '98765432101234567')
    const payload = Buffer.from(
      '{"algorithm":"HMAC-SHA256","user_id":98765432101234567}',
    ).toString('base64url')
    const signature = createHmac('sha256', appSecret)
      .update(payload)
      .digest('base64url')
    const result = await f.request('/api/data-deletion', {
      method: 'POST',
      body: new URLSearchParams({ signed_request: `${signature}.${payload}` }),
    })
    assert.equal(result.status, 200)
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM instagram_connection')
          .first()
      ).n,
      0,
    )
  } finally {
    await f.dispose()
  }
})

async function fixture(overrides = {}) {
  const fetchMock = createFetchMock()
  fetchMock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    fetchMock,
    bindings: {
      APP_ORIGIN: origin,
      INSTAGRAM_APP_ID: '123456789',
      INSTAGRAM_APP_SECRET: appSecret,
      INSTAGRAM_ACCOUNT_USERNAME: 'jb_test_single',
      INSTAGRAM_API_VERSION: 'v26.0',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      ...overrides,
    },
  })
  const db = await mf.getD1Database('DB')
  await db.batch(
    migration
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  )
  const request = (path, options = {}) =>
    mf.dispatchFetch(origin + path, { redirect: 'manual', ...options })
  function mockLogin(username = 'jb_test_single', userId = '178414123456789') {
    fetchMock
      .get('https://api.instagram.com')
      .intercept({ path: '/oauth/access_token', method: 'POST' })
      .reply(200, { access_token: 'test-only-short-token', user_id: userId })
    fetchMock
      .get('https://graph.instagram.com')
      .intercept({ path: /^\/access_token\?/, method: 'GET' })
      .reply(200, {
        access_token: rawToken,
        expires_in: 5184000,
        token_type: 'bearer',
      })
    fetchMock
      .get('https://graph.instagram.com')
      .intercept({ path: /^\/v26\.0\/me\?/, method: 'GET' })
      .reply(200, { user_id: userId, username })
  }
  async function begin() {
    const response = await request('/api/auth/instagram/start', {
      method: 'POST',
      headers: { Origin: origin },
    })
    assert.equal(response.status, 303)
    const url = new URL(response.headers.get('Location'))
    const state = url.searchParams.get('state')
    return {
      state,
      url,
      response,
      cookie: response.headers.getSetCookie()[0].split(';')[0],
    }
  }
  async function finish(beginning) {
    return request(
      `/api/auth/instagram/callback?state=${beginning.state}&code=test-code`,
      { headers: { Cookie: beginning.cookie } },
    )
  }
  async function login() {
    const beginning = await begin()
    mockLogin()
    const response = await finish(beginning)
    assert.match(response.headers.get('Location'), /instagram_connected=1/)
    const cookie = response.headers
      .getSetCookie()
      .find((x) => x.startsWith('__Host-jbgolf_session='))
      ?.split(';')[0]
    assert.ok(cookie)
    const status = await (
      await request('/api/connection', { headers: { Cookie: cookie } })
    ).json()
    return { cookie, status, beginning, response }
  }
  return {
    mf,
    db,
    fetchMock,
    request,
    mockLogin,
    begin,
    finish,
    login,
    dispose: () => mf.dispose(),
  }
}

test('설정되지 않은 서버는 연결 완료로 표시하지 않는다', async () => {
  const f = await fixture({ INSTAGRAM_APP_SECRET: '' })
  try {
    const status = await (await f.request('/api/connection')).json()
    assert.equal(status.configured, false)
    assert.equal(status.advertisingAccess, false)
    const start = await f.request('/api/auth/instagram/start', {
      method: 'POST',
      headers: { Origin: origin },
    })
    assert.equal(start.status, 503)
  } finally {
    await f.dispose()
  }
})

test('인스타그램 전용 로그인, CSRF state와 일회성 처리를 검증한다', async () => {
  const f = await fixture()
  try {
    assert.equal(
      (
        await f.request('/api/auth/instagram/start', {
          method: 'POST',
          headers: { Origin: 'https://other.test' },
        })
      ).status,
      403,
    )
    const beginning = await f.begin()
    assert.equal(beginning.url.origin, 'https://www.instagram.com')
    assert.equal(beginning.url.searchParams.get('enable_fb_login'), '0')
    assert.equal(
      beginning.url.searchParams.get('scope'),
      'instagram_business_basic',
    )
    assert.match(
      beginning.response.headers.getSetCookie()[0],
      /HttpOnly; Secure; SameSite=Lax/,
    )
    const bad = await f.request(
      `/api/auth/instagram/callback?state=${beginning.state}&code=bad`,
    )
    assert.match(bad.headers.get('Location'), /invalid_state/)
    f.mockLogin()
    const success = await f.finish(beginning)
    assert.match(success.headers.get('Location'), /instagram_connected=1/)
    const replay = await f.finish(beginning)
    assert.match(replay.headers.get('Location'), /expired_state/)
  } finally {
    await f.dispose()
  }
})

test('하나의 허용 계정만 연결하고 토큰은 암호화하며 광고 권한과 구분한다', async () => {
  const f = await fixture()
  try {
    const { status, cookie } = await f.login()
    assert.equal(status.authenticated, true)
    assert.equal(status.connection.username, 'jb_test_single')
    assert.equal(status.advertisingAccess, false)
    assert.equal(JSON.stringify(status).includes(rawToken), false)
    assert.equal(JSON.stringify(status).includes(appSecret), false)
    const stored = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    assert.match(stored.encrypted_token, /^v1\./)
    assert.equal(stored.encrypted_token.includes(rawToken), false)
    const rejected = await f.begin()
    f.mockLogin('someone_else')
    assert.match(
      (await f.finish(rejected)).headers.get('Location'),
      /different_instagram_account/,
    )
    const after = await (
      await f.request('/api/connection', { headers: { Cookie: cookie } })
    ).json()
    assert.equal(after.connection.userId, status.connection.userId)
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM instagram_connection')
          .first()
      ).n,
      1,
    )
  } finally {
    await f.dispose()
  }
})

test('연결 해제에는 로그인·동일 출처·CSRF가 모두 필요하다', async () => {
  const f = await fixture()
  try {
    const { cookie, status } = await f.login()
    assert.equal(
      (
        await f.request('/api/connection', {
          method: 'DELETE',
          headers: {
            Cookie: cookie,
            Origin: 'https://other.test',
            'X-CSRF-Token': status.csrfToken,
          },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await f.request('/api/connection', {
          method: 'DELETE',
          headers: { Cookie: cookie, Origin: origin },
        })
      ).status,
      401,
    )
    assert.equal(
      (
        await f.request('/api/connection', {
          method: 'DELETE',
          headers: {
            Cookie: cookie,
            Origin: origin,
            'X-CSRF-Token': status.csrfToken,
          },
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM instagram_connection')
          .first()
      ).n,
      0,
    )
    assert.equal(
      (await f.db.prepare('SELECT COUNT(*) AS n FROM sessions').first()).n,
      0,
    )
  } finally {
    await f.dispose()
  }
})

test('잘못된 삭제 서명은 거부하고 유효한 요청은 계정과 세션을 삭제한다', async () => {
  const f = await fixture()
  try {
    await f.login()
    assert.equal(
      (
        await f.request('/api/data-deletion', {
          method: 'POST',
          body: new URLSearchParams({ signed_request: 'bad.payload' }),
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM instagram_connection')
          .first()
      ).n,
      1,
    )
    const payload = Buffer.from(
      JSON.stringify({
        algorithm: 'HMAC-SHA256',
        user_id: '178414123456789',
        issued_at: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url')
    const signature = createHmac('sha256', appSecret)
      .update(payload)
      .digest('base64url')
    const deletion = await f.request('/api/data-deletion', {
      method: 'POST',
      body: new URLSearchParams({ signed_request: `${signature}.${payload}` }),
    })
    assert.equal(deletion.status, 200)
    const data = await deletion.json()
    assert.match(data.url, /^https:\/\/jb-golf.test\/data-deletion\?code=/)
    const confirmation = await (
      await f.request('/api/data-deletion/' + data.confirmation_code)
    ).json()
    assert.equal(confirmation.status, 'deleted')
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM instagram_connection')
          .first()
      ).n,
      0,
    )
  } finally {
    await f.dispose()
  }
})

test('장기 토큰을 갱신하고 재실행으로 중복 갱신하지 않는다', async () => {
  const f = await fixture()
  try {
    await f.login()
    const before = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    await f.db
      .prepare(
        'UPDATE instagram_connection SET token_expires_at=?,last_refreshed_at=?',
      )
      .bind(Date.now() + 86400000, Date.now() - 172800000)
      .run()
    f.fetchMock
      .get('https://graph.instagram.com')
      .intercept({ path: /^\/refresh_access_token\?/, method: 'GET' })
      .reply(200, {
        access_token: 'test-only-refreshed-token',
        expires_in: 5184000,
      })
    const worker = await f.mf.getWorker()
    await worker.scheduled({ cron: '0 0 * * *' })
    const after = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    assert.notEqual(after.encrypted_token, before.encrypted_token)
    assert.ok(after.token_expires_at > Date.now() + 30 * 86400000)
    await worker.scheduled({ cron: '0 0 * * *' })
    assert.equal(
      (await f.db.prepare('SELECT * FROM instagram_connection').first())
        .encrypted_token,
      after.encrypted_token,
    )
  } finally {
    await f.dispose()
  }
})

test('허용 이름이 같아도 이미 연결된 계정 ID는 다른 ID로 교체하지 않는다', async () => {
  const f = await fixture()
  try {
    const first = await f.login()
    const beginning = await f.begin()
    f.mockLogin('jb_test_single', '999999999999999')
    const callback = await f.finish(beginning)
    assert.match(
      callback.headers.get('Location'),
      /different_instagram_account/,
    )
    const stored = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    assert.equal(stored.user_id, first.status.connection.userId)
  } finally {
    await f.dispose()
  }
})

test('갱신 실패 시 기존의 유효한 연결 토큰과 만료 시각을 보존한다', async () => {
  const f = await fixture()
  try {
    await f.login()
    await f.db
      .prepare(
        'UPDATE instagram_connection SET token_expires_at=?,last_refreshed_at=?',
      )
      .bind(Date.now() + 86400000, Date.now() - 172800000)
      .run()
    const before = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    f.fetchMock
      .get('https://graph.instagram.com')
      .intercept({ path: /^\/refresh_access_token\?/, method: 'GET' })
      .reply(503, { error: { message: rawToken } })
    await (await f.mf.getWorker()).scheduled({ cron: '0 0 * * *' })
    const after = await f.db
      .prepare('SELECT * FROM instagram_connection')
      .first()
    assert.equal(after.encrypted_token, before.encrypted_token)
    assert.equal(after.token_expires_at, before.token_expires_at)
    assert.equal(after.refresh_error, 'instagram_unreachable')
    assert.equal(JSON.stringify(after).includes(rawToken), false)
  } finally {
    await f.dispose()
  }
})
