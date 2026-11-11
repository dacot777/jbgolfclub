import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const bundle = await build({
  stdin: {
    contents: `import { collectMetaAds, readMetaAds } from './worker/meta-ads.ts';
      export default { async fetch(req, env) {
        if (req.method === 'POST') await collectMetaAds(env, new Date('2026-02-01T16:00:00Z'));
        return Response.json(await readMetaAds(env))
      } }`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  write: false,
})

async function fixture(bindings = {}) {
  const fetchMock = createFetchMock()
  fetchMock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    fetchMock,
    bindings: {
      META_AD_ACCOUNT_ID: '1234',
      META_ADS_API_VERSION: 'v26.0',
      META_ADS_ACCESS_TOKEN: 'synthetic-local-test',
      ...bindings,
    },
  })
  const db = await mf.getD1Database('DB')
  const migration = await readFile(
    'worker/migrations/0005_meta_ads.sql',
    'utf8',
  )
  await db.batch(
    migration
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  )
  const request = async (method = 'GET') =>
    (await mf.dispatchFetch('https://mock.test/', { method })).json()
  const pool = fetchMock.get('https://graph.facebook.com')
  const intercept = (path) =>
    pool.intercept({
      path,
      method: 'GET',
      headers: { authorization: 'Bearer synthetic-local-test' },
    })
  const account = () =>
    intercept(/^\/v26\.0\/act_1234\?/).reply(200, {
      account_id: '1234',
      currency: 'KRW',
      timezone_name: 'Asia/Seoul',
    })
  const periodRows = () => {
    for (let i = 0; i < 4; i++) {
      intercept(/\/insights\?.*level=account/).reply(200, ({ path }) => {
        const q = new URL(path, 'https://mock.test').searchParams
        assert.equal(q.get('breakdowns'), 'publisher_platform')
        const range = JSON.parse(q.get('time_range'))
        return {
          data:
            range.since === '2026-01-01'
              ? []
              : [
                  {
                    date_start: range.since,
                    date_stop: range.until,
                    publisher_platform: 'facebook',
                    reach: '99999',
                  },
                  {
                    date_start: range.since,
                    date_stop: range.until,
                    publisher_platform: 'instagram',
                    reach: '22',
                    impressions: '30',
                    spend: '100',
                    inline_link_clicks: '0',
                  },
                ],
        }
      })
    }
  }
  const ad = (id, spend, platform = 'instagram') => ({
    date_start: '2026-02-02',
    date_stop: '2026-02-02',
    publisher_platform: platform,
    ad_id: id,
    ad_name: 'Synthetic ad ' + id,
    impressions: '9',
    spend,
  })
  function success(spend) {
    account()
    periodRows()
    intercept(/\/insights\?.*level=ad/).reply(200, {
      data: [ad('10', '1000', 'facebook'), ad('11', spend)],
      paging: {
        cursors: { after: 'opaque' },
        next: 'https://unused.invalid/never-follow',
      },
    })
    intercept(/\/insights\?.*after=opaque/).reply(200, {
      data: [ad('12', '0')],
    })
  }
  return { db, mf, request, account, periodRows, intercept, success }
}

test('collects only Instagram, uses account-local calendar and Meta period reach, and retains last complete snapshot through failure', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request()).status, 'pending')
    f.success('105')
    const report = await f.request('POST')
    assert.equal(report.status, 'ready')
    assert.equal(report.currency, 'KRW')
    assert.equal(report.timeZone, 'Asia/Seoul')
    assert.deepEqual(
      report.daily.map((r) => [r.adId, r.spend, r.linkClicks]),
      [
        ['11', 105, null],
        ['12', 0, null],
      ],
    )
    assert.equal(report.periods.length, 4)
    assert.equal(
      report.periods.find((p) => p.since === '2026-01-01').reach,
      null,
    )
    assert.deepEqual(
      report.periods.find((p) => p.kind === 'week' && p.since === '2026-02-02'),
      {
        kind: 'week',
        since: '2026-02-02',
        until: '2026-02-02',
        spend: 100,
        impressions: 30,
        linkClicks: 0,
        reach: 22,
      },
    )
    f.success('120')
    const corrected = await f.request('POST')
    assert.deepEqual(
      corrected.daily.map((r) => r.spend),
      [120, 0],
    )
    f.account()
    f.periodRows()
    f.intercept(/\/insights\?.*level=ad/).reply(200, {
      data: [],
      paging: { cursors: { after: 'second' }, next: 'unused' },
    })
    f.intercept(/\/insights\?.*after=second/).reply(403, {
      error: { message: 'sensitive response' },
    })
    const failed = await f.request('POST')
    assert.deepEqual(failed, { ...corrected, status: 'error' })
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT COUNT(*) AS n FROM meta_ads_reports WHERE kind='month'",
          )
          .first()
      ).n,
      2,
    )
  } finally {
    await f.mf.dispose()
  }
})

test('a worker without credentials skips collection and never reports authorization', async () => {
  const f = await fixture({ META_ADS_ACCESS_TOKEN: '' })
  try {
    assert.deepEqual(await f.request('POST'), {
      status: 'unconfigured',
      lastSyncedAt: null,
      currency: null,
      timeZone: null,
      periods: [],
      daily: [],
    })
    assert.equal(
      (await f.db.prepare('SELECT COUNT(*) AS n FROM meta_ads_sync').first()).n,
      0,
    )
  } finally {
    await f.mf.dispose()
  }
})
