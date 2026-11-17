import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const origin = 'https://calendar.test'
const password = 'fixture-password'
const salt = '0123456789abcdef0123456789abcdef'
const verifier =
  'v1$' +
  salt +
  '$' +
  createHash('sha256')
    .update(salt + ':' + password)
    .digest('hex')
const appSecret = 'test-only-calendar-secret'
const token = 'test-only-long-grant'
const account = 'jbgolfclub_bundang'
const userId = '98800000000000001'
const callback = '/api/auth/instagram/calendar/callback'
const connect = '/api/admin/calendar/instagram/connect/'
const bundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const migrations = await Promise.all(
  [
    '0001_single_instagram',
    '0004_admin_analytics',
    '0010_calendar_schedules',
    '0011_calendar_instagram',
  ].map((n) => readFile('worker/migrations/' + n + '.sql', 'utf8')),
)

async function fixture() {
  const mock = createFetchMock()
  mock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    fetchMock: mock,
    bindings: {
      APP_ORIGIN: origin,
      INSTAGRAM_APP_ID: '123456789',
      INSTAGRAM_APP_SECRET: appSecret,
      INSTAGRAM_ACCOUNT_USERNAME: 'jbgolfacademy',
      INSTAGRAM_API_VERSION: 'v26.0',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      ADMIN_PASSWORD_VERIFIER: verifier,
      ADMIN_ANALYTICS_KEY:
        'test-only-admin-key-0123456789abcdefabcdef9876543210',
    },
  })
  const db = await mf.getD1Database('DB')
  await db.batch(
    migrations
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  )
  const request = (path, options = {}) =>
    mf.dispatchFetch(origin + path, { redirect: 'manual', ...options })
  const login = await request('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
    headers: { Origin: origin, 'Content-Type': 'application/json' },
  })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('Set-Cookie').split(';')[0]
  const auth = {
    Cookie: cookie,
    Origin: origin,
    'X-CSRF-Token': (await login.json()).csrfToken,
  }
  const begin = async (handle = account) => {
    const res = await request(connect + handle, {
      method: 'POST',
      headers: auth,
    })
    assert.equal(res.status, 200)
    const authUrl = new URL((await res.json()).url)
    assert.equal(authUrl.searchParams.get('scope'), 'instagram_business_basic')
    assert.equal(authUrl.searchParams.get('redirect_uri'), origin + callback)
    return {
      state: authUrl.searchParams.get('state'),
      cookie: res.headers.get('Set-Cookie').split(';')[0],
    }
  }
  const graph = mock.get('https://graph.instagram.com')
  const mockOAuth = (username = account, id = userId) => {
    mock
      .get('https://api.instagram.com')
      .intercept({ method: 'POST', path: '/oauth/access_token' })
      .reply(200, { access_token: 'test-only-short', user_id: id })
    graph
      .intercept({ path: /^\/access_token\?/ })
      .reply(200, { access_token: token, expires_in: 5184000 })
    graph
      .intercept({ path: /^\/v26\.0\/me\?/ })
      .reply(200, { id, username, user_id: id })
  }
  const finish = (pending) =>
    request(callback + '?code=test&state=' + pending.state, {
      headers: { Cookie: pending.cookie },
    })
  const month = async () =>
    (
      await request('/api/admin/calendar?month=2028-02', { headers: auth })
    ).json()
  const reply = (page, body, status = 200) => {
    graph
      .intercept({
        path: (url) => {
          const u = new URL(url, 'https://graph.instagram.com')
          return (
            u.pathname === '/v26.0/' + userId + '/media' &&
            u.searchParams.get('after') === page
          )
        },
        headers: { authorization: 'Bearer ' + token },
      })
      .reply(status, body)
  }
  const tick = async () =>
    (await mf.getWorker()).scheduled({ cron: '45 * * * *' })
  return {
    mf,
    db,
    graph,
    request,
    auth,
    begin,
    finish,
    mockOAuth,
    month,
    reply,
    tick,
  }
}

const reel = {
  id: '90111111111111111',
  caption: '테스트 릴스',
  media_type: 'VIDEO',
  timestamp: '2028-01-31T15:15:00+0000',
  permalink: 'https://www.instagram.com/reel/demotest/',
  media_url: 'https://test.cdninstagram.com/source.mp4',
  thumbnail_url: 'https://test.cdninstagram.com/reel.jpg',
}
const post = {
  id: '90111111111111112',
  caption: '가상 이미지',
  media_type: 'IMAGE',
  timestamp: '2028-02-01T23:05:00+0000',
  permalink: 'https://www.instagram.com/p/demo2/',
  media_url: 'https://test.fbcdn.net/post.jpg',
}
const oldest = {
  ...post,
  id: '90111111111111113',
  timestamp: '2028-01-05T11:00:00+0000',
  permalink: 'https://www.instagram.com/p/oldtest/',
}

test('verified professional grant syncs actual media, KST boundaries, image CDN fallback, history and revocation', async () => {
  const f = await fixture()
  try {
    assert.equal(
      (
        await f.request(connect + account, {
          method: 'POST',
          headers: { Cookie: f.auth.Cookie, Origin: origin },
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await f.request(connect + 'unapproved', {
          method: 'POST',
          headers: f.auth,
        })
      ).status,
      400,
    )
    assert.ok(
      (await f.month()).accounts.every((a) => a.status === 'needs_connection'),
    )
    const pending = await f.begin()
    f.mockOAuth()
    const head = {
      data: [reel, post],
      paging: {
        cursors: { after: 'older' },
        next: 'https://graph.instagram.com/unused?access_token=do-not-follow',
      },
    }
    f.reply(null, head)
    assert.equal(
      (await f.finish(pending)).headers.get('Location'),
      origin + '/?calendar_instagram=connected#calendar',
    )
    const initial = await f.month()
    assert.equal(
      (
        await f.db
          .prepare('SELECT sync_error FROM calendar_instagram_accounts')
          .first()
      ).sync_error,
      null,
    )
    assert.equal(
      initial.accounts.find((a) => a.account === account).status,
      'syncing',
    )
    assert.deepEqual(
      initial.posts.map((x) => [x.account, x.kind, x.date, x.time]),
      [
        [account, 'reel', '2028-02-01', '00:15'],
        [account, 'post', '2028-02-02', '08:05'],
      ],
    )
    assert.equal(JSON.stringify(initial).includes('cdninstagram'), false)
    const src = initial.posts[0].thumbnailUrl
    assert.equal((await f.request(src)).status, 401)
    assert.equal(
      (await f.request(src, { headers: f.auth })).headers.get('Location'),
      reel.thumbnail_url,
    )
    const [stored, legacy] = await Promise.all([
      f.db
        .prepare('SELECT encrypted_token FROM calendar_instagram_accounts')
        .first(),
      f.db.prepare('SELECT COUNT(*) AS n FROM instagram_connection').first(),
    ])
    assert.match(stored.encrypted_token, /^v1\./)
    assert.ok(!stored.encrypted_token.includes(token))
    assert.equal(legacy.n, 0)
    f.reply(null, head)
    f.reply('older', { data: [oldest] })
    await f.tick()
    assert.equal(
      (await f.month()).accounts.find((a) => a.account === account).status,
      'connected',
    )
    assert.equal(
      (
        await f.db
          .prepare('SELECT COUNT(*) AS n FROM calendar_instagram_media')
          .first()
      ).n,
      3,
    )
    f.reply(null, { error: { code: 4 } }, 429)
    await f.tick()
    const failed = await f.month()
    assert.equal(
      failed.accounts.find((a) => a.account === account).status,
      'error',
    )
    assert.equal(failed.posts.length, 2)
    await f.db
      .prepare(
        'UPDATE calendar_instagram_media SET thumbnail_checked_at=0 WHERE id=?',
      )
      .bind(reel.id)
      .run()
    f.graph
      .intercept({ path: new RegExp('^/v26\\.0/' + reel.id + '\\?') })
      .reply(200, {
        ...reel,
        thumbnail_url: 'https://test.cdninstagram.com/fresh.jpg',
      })
    assert.equal(
      (await f.request(src, { headers: f.auth })).headers.get('Location'),
      'https://test.cdninstagram.com/fresh.jpg',
    )
    const payload = Buffer.from(
      JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: userId }),
    ).toString('base64url')
    const sig = createHmac('sha256', appSecret)
      .update(payload)
      .digest('base64url')
    assert.equal(
      (
        await f.request('/api/auth/instagram/deauthorize', {
          method: 'POST',
          body: new URLSearchParams({ signed_request: sig + '.' + payload }),
        })
      ).status,
      200,
    )
    const revoked = await f.month()
    assert.equal(revoked.posts.length, 0)
    assert.equal(
      revoked.accounts.find((a) => a.account === account).status,
      'needs_connection',
    )
  } finally {
    await f.mf.dispose()
  }
})

test('calendar sign-in rejects the wrong user, swapped ID, replay and logged-out authorization state', async () => {
  const f = await fixture()
  try {
    let pending = await f.begin()
    f.mockOAuth('jbgolfacademy')
    assert.match(
      (await f.finish(pending)).headers.get('Location'),
      /different_instagram_account/,
    )
    assert.match(
      (await f.finish(pending)).headers.get('Location'),
      /expired_state/,
    )
    pending = await f.begin()
    f.mockOAuth()
    f.reply(null, { data: [] })
    assert.match(
      (await f.finish(pending)).headers.get('Location'),
      /calendar_instagram=connected/,
    )
    assert.equal(
      (await f.month()).accounts.find((a) => a.account === account).status,
      'connected',
    )
    pending = await f.begin()
    f.mockOAuth(account, '98800000000000002')
    assert.match(
      (await f.finish(pending)).headers.get('Location'),
      /different_instagram_account/,
    )
    assert.equal(
      (
        await f.db
          .prepare('SELECT user_id FROM calendar_instagram_accounts')
          .first()
      ).user_id,
      userId,
    )
    pending = await f.begin()
    assert.match(
      (await f.finish({ ...pending, cookie: '' })).headers.get('Location'),
      /invalid_state/,
    )
    await f.db.prepare('DELETE FROM admin_sessions').run()
    assert.match(
      (await f.finish(pending)).headers.get('Location'),
      /expired_state/,
    )
  } finally {
    await f.mf.dispose()
  }
})
test('carousel without a parent image resolves its first child once; explicit token expiry requests reconnection', async () => {
  const f = await fixture()
  try {
    const pending = await f.begin()
    f.mockOAuth()
    const album = {
      ...post,
      id: '90111111111111115',
      media_type: 'CAROUSEL_ALBUM',
      media_url: undefined,
    }
    f.reply(null, { data: [album] })
    assert.match(
      (await f.finish(pending)).headers.get('Location'),
      /calendar_instagram=connected/,
    )
    const src = (await f.month()).posts[0].thumbnailUrl
    assert.ok(src)
    f.graph
      .intercept({ path: new RegExp('^/v26\\.0/' + album.id + '/children\\?') })
      .reply(200, { data: [{ ...reel, id: '90111111111111116' }] })
    assert.equal(
      (await f.request(src, { headers: f.auth })).headers.get('Location'),
      reel.thumbnail_url,
    )
    f.reply(null, { data: [album] })
    await f.tick()
    assert.equal(
      (await f.request(src, { headers: f.auth })).headers.get('Location'),
      reel.thumbnail_url,
    )
    f.reply(null, { error: { code: 190 } }, 400)
    await f.tick()
    const month = await f.month()
    assert.equal(
      month.accounts.find((a) => a.account === account).status,
      'needs_connection',
    )
    assert.equal(month.posts[0].id, album.id)
  } finally {
    await f.mf.dispose()
  }
})
