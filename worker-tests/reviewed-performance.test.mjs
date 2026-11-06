import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const origin = 'https://jb-golf.test'
const bundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const migration = await readFile(
  'worker/migrations/0002_reviewed_performance.sql',
  'utf8',
)
const ad = (overrides = {}) => ({
  id: 'test-post-a',
  title: '검증용 게시물 A',
  postUrl: 'https://www.instagram.com/p/TestPostA/',
  objective: '프로필 방문',
  status: 'active',
  schedule: {
    start: '2026-01-01',
    end: '2026-01-31',
    dailyBudget: 100,
    durationDays: 30,
  },
  ...overrides,
})
const snapshot = (overrides = {}) => ({
  id: 'test-snapshot-a',
  adId: 'test-post-a',
  period: null,
  scope: 'lifetime',
  reportedDays: 7,
  metrics: {
    spend: 1000,
    profileVisits: 10,
    profileVisitCost: 100,
    websiteVisits: null,
    websiteVisitCost: null,
    views: 100,
    viewers: 80,
    postEngagements: 12,
    linkClicks: 0,
    likes: 2,
    video3s: null,
  },
  reviewedAt: '2026-02-01T00:00:00Z',
  sourceLabel: '합성 검사 자료',
  notes: '',
  ...overrides,
})

async function fixture({ withDatabase = true, migrate = true } = {}) {
  const fetchMock = createFetchMock()
  fetchMock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    ...(withDatabase ? { d1Databases: ['DB'] } : {}),
    fetchMock,
    bindings: { APP_ORIGIN: origin },
  })
  const db = withDatabase ? await mf.getD1Database('DB') : null
  if (db && migrate)
    await db.batch(
      migration
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((sql) => db.prepare(sql)),
    )
  return {
    db,
    request: (path = '/api/performance', options = {}) =>
      mf.dispatchFetch(origin + path, options),
    async insertAd(value) {
      await db
        .prepare(
          'INSERT INTO reviewed_ads(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        )
        .bind(value.id, JSON.stringify(value))
        .run()
    },
    async insertSnapshot(value) {
      await db
        .prepare(
          'INSERT INTO reviewed_snapshots(id,ad_id,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET ad_id=excluded.ad_id,data=excluded.data',
        )
        .bind(value.id, value.adId, JSON.stringify(value))
        .run()
    },
    dispose: () => mf.dispose(),
  }
}

test('검토 자료가 없으면 빈 계약을 반환하고 Meta 연결 성공으로 주장하지 않는다', async () => {
  const f = await fixture()
  try {
    const response = await f.request()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null)
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.deepEqual(await response.json(), {
      version: 1,
      source: 'reviewed_screenshots',
      expectedAdCount: 2,
      updatedAt: null,
      ads: [],
      snapshots: [],
    })
    const connection = await f.request('/api/connection')
    assert.equal(connection.status, 200)
    assert.deepEqual(await connection.json(), {
      configured: false,
      authenticated: false,
      connection: null,
      advertisingAccess: false,
    })
  } finally {
    await f.dispose()
  }
})

test('서버에 보관한 확정/미확인 기간과 0/누락을 그대로 읽고 허용 필드만 공개한다', async () => {
  const f = await fixture()
  try {
    const reviewedAd = ad({
      accountId: 'private-test-id',
      access_token: 'private-test-secret',
    })
    const unknown = snapshot({ extra: 'private-test-value' })
    const selected = snapshot({
      id: 'test-snapshot-b',
      period: { start: '2026-01-01', end: '2026-01-07' },
      scope: 'selected_period',
      reportedDays: null,
      reviewedAt: '2026-02-02T09:00:00+09:00',
      metrics: {
        ...unknown.metrics,
        profileVisits: null,
        websiteVisits: 5,
        websiteVisitCost: 200,
      },
    })
    await f.insertAd(reviewedAd)
    await f.insertSnapshot(unknown)
    await f.insertSnapshot(selected)
    const response = await f.request()
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.updatedAt, selected.reviewedAt)
    assert.equal(data.snapshots[0].period, null)
    assert.equal(data.snapshots[0].scope, 'lifetime')
    assert.equal(data.snapshots[0].reportedDays, 7)
    assert.equal(data.snapshots[0].metrics.linkClicks, 0)
    assert.equal(data.snapshots[0].metrics.video3s, null)
    assert.equal(data.snapshots[1].metrics.websiteVisits, 5)
    assert.equal(data.snapshots[1].metrics.profileVisits, null)
    assert.deepEqual(data.snapshots[1].period, {
      start: '2026-01-01',
      end: '2026-01-07',
    })
    const encoded = JSON.stringify(data)
    for (const privateValue of [
      'private-test-id',
      'private-test-secret',
      'private-test-value',
      'accountId',
      'access_token',
    ])
      assert.equal(encoded.includes(privateValue), false)
    assert.equal('authenticated' in data, false)
    assert.equal('advertisingAccess' in data, false)
  } finally {
    await f.dispose()
  }
})

test('조회 API에 쓰기 기능이 없으며 POST/PUT/PATCH/DELETE로 기존 자료를 바꾸지 못한다', async () => {
  const f = await fixture()
  try {
    await f.insertAd(ad())
    await f.insertSnapshot(snapshot())
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await f.request('/api/performance', {
        method,
        body: '{"ads":[]}',
      })
      assert.equal(response.status, 404)
    }
    assert.equal(
      (await f.request('/api/performance', { method: 'OPTIONS' })).status,
      403,
    )
    const result = await (await f.request()).json()
    assert.equal(result.ads.length, 1)
    assert.equal(result.snapshots.length, 1)
    assert.equal(result.snapshots[0].metrics.spend, 1000)
  } finally {
    await f.dispose()
  }
})

test('잘못된 날짜·부분 기간·수치·외부 링크를 실제 실적으로 반환하지 않는다', async () => {
  const f = await fixture()
  try {
    await f.insertAd(ad())
    const cases = [
      snapshot({ scope: 'selected_period' }),
      snapshot({ period: { start: '2026-01-01' } }),
      snapshot({ period: { start: '2026-01-07', end: '2026-01-01' } }),
      snapshot({ period: { start: '2026-02-30', end: '2026-03-01' } }),
      snapshot({ metrics: { ...snapshot().metrics, spend: -1 } }),
      snapshot({ metrics: { ...snapshot().metrics, spend: 0.5 } }),
      snapshot({
        metrics: { ...snapshot().metrics, spend: Number.MAX_SAFE_INTEGER + 1 },
      }),
      snapshot({ metrics: { ...snapshot().metrics, spend: '1000' } }),
      snapshot({ reviewedAt: '2026-02-30T00:00:00Z' }),
      snapshot({ reportedDays: 0 }),
    ]
    for (const value of cases) {
      await f.insertSnapshot(value)
      const response = await f.request()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), {
        error: { code: 'performance_unavailable' },
      })
    }
    await f.insertSnapshot(snapshot())
    for (const postUrl of [
      'https://evil.example/p/TestPostA/',
      'javascript:alert(1)',
      'https://www.instagram.com/p/TestPostA/?tracking=secret',
    ]) {
      await f.insertAd(ad({ postUrl }))
      assert.equal((await f.request()).status, 503)
    }
  } finally {
    await f.dispose()
  }
})

test('DB 또는 마이그레이션이 없으면 빈 실적으로 가장하지 않고 503을 반환한다', async () => {
  for (const options of [{ withDatabase: false }, { migrate: false }]) {
    const f = await fixture(options)
    try {
      const response = await f.request()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), {
        error: { code: 'performance_unavailable' },
      })
    } finally {
      await f.dispose()
    }
  }
})
