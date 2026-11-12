import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const bundle = await build({
  stdin: {
    contents: `import worker from './worker/index.ts';
      import { collectMetaAds, readMetaAds } from './worker/meta-ads.ts';
      export default { async fetch(req, env) {
        if (new URL(req.url).pathname.startsWith('/api/')) return worker.fetch(req, env);
        if (req.method === 'POST') await collectMetaAds(env, new Date(new URL(req.url).searchParams.get('at') || '2026-02-01T16:00:00Z'));
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
  const migration = (
    await Promise.all([
      readFile('worker/migrations/0002_reviewed_performance.sql', 'utf8'),
      readFile('worker/migrations/0005_meta_ads.sql', 'utf8'),
      readFile('worker/migrations/0006_meta_ad_registry.sql', 'utf8'),
    ])
  ).join('\n')
  await db.batch(
    migration
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  )
  const request = async (method = 'GET', at = '') =>
    (
      await mf.dispatchFetch(
        'https://mock.test/?at=' + encodeURIComponent(at),
        { method },
      )
    ).json()
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
    assert.equal(
      (
        await f.db
          .prepare(
            "SELECT payload->>'$.spend' AS spend FROM meta_ad_history_revisions WHERE ad_id='11' AND kind='day'",
          )
          .first()
      ).spend,
      105,
    )
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

test('the public report reads the saved snapshot without login and exposes only display fields', async () => {
  const f = await fixture()
  const url = 'https://mock.test/api/meta-ads'
  try {
    const pending = await f.mf.dispatchFetch(url)
    assert.equal(pending.status, 200)
    assert.equal((await pending.json()).status, 'pending')
    f.success('105')
    const saved = await f.request('POST')
    await f.db
      .prepare(
        `UPDATE meta_ads_reports SET payload=json_set(payload,
        CASE WHEN kind='day' THEN '$[0].campaign_id' ELSE '$.account_id' END, 'test-private-id')
       WHERE kind!='day' OR since='2026-02-02'`,
      )
      .run()
    const response = await f.mf.dispatchFetch(url)
    assert.equal(response.status, 200)
    const report = await response.json()
    assert.equal(report.cards.length, 2)
    assert.ok(
      report.cards.every(
        (card) =>
          /^meta-[0-9a-f-]{36}$/.test(card.id) && card.status === 'unknown',
      ),
    )
    const { cards, ...snapshot } = report
    assert.deepEqual(snapshot, {
      status: 'ready',
      lastSyncedAt: saved.lastSyncedAt,
      currency: saved.currency,
      timeZone: saved.timeZone,
      periods: saved.periods,
      daily: saved.daily.map(({ adId, ...display }) => display),
      adPeriods: [],
    })
    assert.equal(
      (await f.mf.dispatchFetch(url, { method: 'POST' })).status,
      404,
    )
    assert.equal(
      (await f.db.prepare('SELECT status FROM meta_ads_sync').first()).status,
      'ready',
    )
  } finally {
    await f.mf.dispose()
  }
})

async function reviewedCard(
  f,
  id,
  post,
  explicitAdIds = [],
  accountId = '1234',
) {
  await f.db
    .prepare('INSERT INTO reviewed_ads(id,data) VALUES (?,?)')
    .bind(
      id,
      JSON.stringify({
        postUrl: 'https://www.instagram.com/p/' + post + '/',
        privateSourceMetadata: { metaAds: { accountId, adIds: explicitAdIds } },
      }),
    )
    .run()
}

function creativeQuery(f) {
  return f.intercept(
    (path) =>
      new URL(path, 'https://mock.test').searchParams.get('fields') ===
      'id,creative{instagram_permalink_url}',
  )
}

test('backfills the first observed delivery week across a month boundary using exact Meta reach, one missing week per run', async () => {
  const f = await fixture()
  const read = async () =>
    (await f.mf.dispatchFetch('https://mock.test/api/meta-ads')).json()
  const period = (start, until) =>
    f.intercept((path) => {
      const q = new URL(path, 'https://mock.test').searchParams
      if (q.get('level') !== 'ad' || q.has('time_increment')) return false
      const range = JSON.parse(q.get('time_range'))
      return range.since === start && range.until === until
    })
  const exactRow = (start, until, reach) => ({
    ad_id: '21',
    date_start: start,
    date_stop: until,
    publisher_platform: 'instagram',
    reach: String(reach),
    spend: '20',
    impressions: '30',
    inline_link_clicks: '1',
  })
  const collect = async (days, at) => {
    f.account()
    f.periodRows()
    f.intercept((path) =>
      new URL(path, 'https://mock.test').searchParams.has('time_increment'),
    ).reply(200, {
      data: days.map((date) => ({
        ...exactRow(date, date, 9),
        ad_name: 'Synthetic october ad',
      })),
    })
    return f.request('POST', at)
  }
  try {
    period('2026-10-01', '2026-10-31').reply(200, {
      data: [exactRow('2026-10-01', '2026-10-31', 15)],
    })
    period('2026-10-19', '2026-10-25').reply(503, { error: { code: 2 } })
    assert.equal(
      (
        await collect(
          ['2026-10-22', '2026-10-30', '2026-10-31'],
          '2026-11-11T00:00:00Z',
        )
      ).status,
      'ready',
    )
    const before = await read()
    assert.equal(
      before.adPeriods.some((row) => row.kind === 'week'),
      false,
    )
    assert.equal(before.adPeriods[0].reach, 15)
    // Stored daily observations remain usable even after they leave the daily query and a backfill failed.
    period('2026-10-26', '2026-11-01').reply(200, {
      data: [exactRow('2026-10-26', '2026-11-01', 11)],
    })
    assert.equal((await collect([], '2026-11-11T01:00:00Z')).status, 'ready')
    const after = await read()
    assert.equal(after.adPeriods.filter((row) => row.kind === 'week').length, 1)
    const week = after.adPeriods.find((row) => row.kind === 'week')
    assert.deepEqual(
      [week.since, week.until, week.reach],
      ['2026-10-26', '2026-11-01', 11],
    )
    assert.equal(after.adPeriods.find((row) => row.kind === 'month').reach, 15)
    assert.ok(
      after.periods.every((row) => row.kind === 'week' || row.kind === 'month'),
    )
    period('2026-10-19', '2026-10-25').reply(200, {
      data: [exactRow('2026-10-19', '2026-10-25', 7)],
    })
    assert.equal((await collect([], '2026-11-12T02:00:00Z')).status, 'ready')
    assert.equal(
      (await read()).adPeriods.filter((row) => row.kind === 'week').length,
      2,
    )
  } finally {
    await f.mf.dispose()
  }
})

function inventory(f, active, known = []) {
  f.intercept((path) =>
    new URL(path, 'https://mock.test').pathname.endsWith('/act_1234/ads'),
  ).reply(200, { data: active })
  for (const ad of known) {
    f.intercept((path) => {
      const url = new URL(path, 'https://mock.test')
      return (
        url.pathname === '/v26.0/' + ad.id &&
        url.searchParams.get('fields')?.includes('effective_status')
      )
    }).reply(200, ad)
  }
  if (known.length)
    f.intercept((path) => {
      const query = new URL(path, 'https://mock.test').searchParams
      return (
        query.has('ids') && query.get('fields')?.includes('effective_status')
      )
    }).reply(200, Object.fromEntries(known.map((ad) => [ad.id, ad])))
}

function observedAd(id, state, post) {
  return {
    id,
    name: 'Synthetic ' + post,
    effective_status: state,
    adset: { start_time: '2026-01-28T00:00:00Z' },
    creative: {
      id: '9' + id,
      instagram_permalink_url: 'https://www.instagram.com/reel/' + post + '/',
    },
  }
}

test('keeps original cards and archived time ranges, records a real pause with bounds through resume, and discovers new IG ads before delivery', async () => {
  const f = await fixture()
  const read = async () =>
    (await f.mf.dispatchFetch('https://mock.test/api/meta-ads')).json()
  try {
    await reviewedCard(f, 'reviewed-one', 'One')
    f.success('105')
    inventory(f, [
      observedAd('11', 'ACTIVE', 'One'),
      observedAd('12', 'ACTIVE', 'Two'),
    ])
    mockAdPeriods(f, [
      { ad_id: '11', spend: '105', impressions: '9', reach: '8' },
      { ad_id: '12', spend: '17', impressions: '20', reach: '15' },
    ])
    assert.equal((await f.request('POST')).status, 'ready')
    const first = await read()
    const original = first.cards.find((card) => card.id === 'reviewed-one')
    assert.equal(first.cards.length, 2)
    assert.equal(original.status, 'active')
    assert.equal(original.firstDeliveryDate, '2026-02-02')
    assert.equal(original.startAt, '2026-01-28T00:00:00.000Z')
    assert.equal(original.pauseEvents.length, 0)
    const runWithoutDelivery = async (at, state) => {
      f.account()
      f.periodRows()
      f.intercept(/\/insights\?.*level=ad/).reply(200, { data: [] })
      const fresh = observedAd('31', 'ACTIVE', 'New')
      const fb = {
        id: '32',
        name: 'Facebook only',
        effective_status: 'ACTIVE',
        adset: { targeting: { publisher_platforms: ['facebook'] } },
      }
      const prior = observedAd('11', state, 'One')
      inventory(
        f,
        [fresh, fb, ...(state === 'ACTIVE' ? [prior] : [])],
        state === 'ACTIVE' ? [] : [prior],
      )
      assert.equal((await f.request('POST', at)).status, 'ready')
      return read()
    }
    const paused = await runWithoutDelivery(
      '2026-04-06T05:00:00Z',
      'CAMPAIGN_PAUSED',
    )
    assert.equal(paused.cards.length, 3)
    const pausedCard = paused.cards.find((card) => card.id === 'reviewed-one')
    assert.equal(pausedCard.status, 'paused')
    assert.deepEqual(pausedCard.pauseEvents, [
      {
        source: 'observed',
        at: '2026-04-06T05:00:00.000Z',
        previousActiveAt: first.lastSyncedAt,
        lastDeliveryDate: '2026-02-02',
      },
    ])
    assert.deepEqual(paused.adPeriods, first.adPeriods)
    assert.deepEqual(paused.daily, first.daily)
    const fresh = paused.cards.find((card) => card.title === 'Synthetic New')
    assert.match(fresh.id, /^meta-/)
    assert.equal(fresh.status, 'active')
    assert.equal(fresh.firstDeliveryDate, null)
    assert.equal(
      paused.adPeriods.some((row) => row.reviewedAdId === fresh.id),
      false,
    )
    const resumed = await runWithoutDelivery('2026-04-08T05:00:00Z', 'ACTIVE')
    assert.equal(
      resumed.cards.find((card) => card.id === 'reviewed-one').status,
      'active',
    )
    assert.deepEqual(
      resumed.cards.find((card) => card.id === 'reviewed-one').pauseEvents,
      pausedCard.pauseEvents,
    )
    assert.equal(
      resumed.cards.find((card) => card.title === 'Synthetic New').id,
      fresh.id,
    )
    const repaused = await runWithoutDelivery('2026-04-09T05:00:00Z', 'PAUSED')
    assert.equal(
      repaused.cards.find((card) => card.id === 'reviewed-one').pauseEvents
        .length,
      2,
    )
  } finally {
    await f.mf.dispose()
  }
})

function mockAdPeriods(f, values) {
  for (let i = 0; i < 2; i++) {
    f.intercept(/\/insights\?.*level=ad/).reply(200, ({ path }) => {
      const q = new URL(path, 'https://mock.test').searchParams
      const { since, until } = JSON.parse(q.get('time_range'))
      assert.equal(q.has('time_increment'), false)
      assert.match(q.get('fields'), /reach/)
      return {
        data: values.map((row) => ({
          date_start: since,
          date_stop: until,
          publisher_platform: 'instagram',
          ...row,
        })),
      }
    })
  }
}

test('per-card weekly and monthly rows join only confirmed ad IDs or matching Instagram posts', async () => {
  const f = await fixture()
  try {
    await reviewedCard(f, 'card-one', 'One')
    await reviewedCard(f, 'card-two', 'Two', ['12'])
    f.success('105')
    creativeQuery(f).reply(400, { error: { code: 100 } })
    for (const [id, creativeId, code] of [
      ['11', '101', 'One'],
      ['12', '102', 'SeparateBoost'],
    ]) {
      f.intercept('/v26.0/' + id + '?fields=creative').reply(200, {
        creative: { id: creativeId },
      })
      f.intercept(
        '/v26.0/' + creativeId + '?fields=instagram_permalink_url',
      ).reply(200, {
        instagram_permalink_url:
          'https://instagram.com/reel/' + code + '/?igsh=test',
      })
    }
    mockAdPeriods(f, [
      {
        ad_id: '11',
        spend: '102',
        impressions: '30',
        reach: '19',
        inline_link_clicks: '0',
      },
      { ad_id: '12', spend: '9', reach: '8' },
      { ad_id: '99', spend: '1000', reach: '999' },
    ])
    await f.request('POST')
    const result = await (
      await f.mf.dispatchFetch('https://mock.test/api/meta-ads')
    ).json()
    assert.deepEqual(
      result.daily.map((r) => r.reviewedAdId),
      ['card-one', 'card-two'],
    )
    assert.equal(result.adPeriods.length, 4)
    for (const kind of ['week', 'month']) {
      const rows = result.adPeriods.filter((p) => p.kind === kind)
      const a = rows.find((p) => p.reviewedAdId === 'card-one')
      const b = rows.find((p) => p.reviewedAdId === 'card-two')
      assert.deepEqual(
        [a.spend, a.impressions, a.linkClicks, a.reach],
        [102, 30, 0, 19],
      )
      assert.deepEqual(
        [b.spend, b.impressions, b.linkClicks, b.reach],
        [9, null, null, 8],
      )
      assert.equal(a.since, kind === 'week' ? '2026-02-02' : '2026-02-01')
      assert.equal(a.until, '2026-02-02')
      assert.equal('adId' in a, false)
    }
  } finally {
    await f.mf.dispose()
  }
})

test('multiple ads on one verified card preserve missing metrics and never sum reach', async () => {
  const f = await fixture()
  try {
    await reviewedCard(f, 'card-one', 'One')
    await reviewedCard(f, 'card-two', 'Two', ['11'], 'other-account')
    f.success('104')
    const ads = Object.fromEntries(
      ['11', '12'].map((id) => [
        id,
        {
          id,
          creative: {
            instagram_permalink_url: 'https://www.instagram.com/p/One/',
          },
        },
      ]),
    )
    creativeQuery(f).reply(200, ads)
    mockAdPeriods(f, [
      {
        ad_id: '11',
        spend: '90',
        impressions: '40',
        reach: '34',
        inline_link_clicks: '2',
      },
      { ad_id: '12', spend: '10', impressions: '10', reach: '7' },
    ])
    await f.request('POST')
    const result = await (
      await f.mf.dispatchFetch('https://mock.test/api/meta-ads')
    ).json()
    assert.equal(result.adPeriods.length, 2)
    for (const row of result.adPeriods)
      assert.deepEqual(
        [
          row.reviewedAdId,
          row.spend,
          row.impressions,
          row.linkClicks,
          row.reach,
        ],
        ['card-one', 100, 50, null, null],
      )
  } finally {
    await f.mf.dispose()
  }
})

test('conflicting card identities stay unassigned and an unrelated delivered ad gets its own card', async () => {
  const f = await fixture()
  try {
    await reviewedCard(f, 'card-one', 'One', ['11'])
    await reviewedCard(f, 'card-two', 'Two')
    f.success('104')
    creativeQuery(f).reply(200, {
      11: {
        id: '11',
        creative: {
          instagram_permalink_url: 'https://www.instagram.com/p/Two/',
        },
      },
      12: {
        id: '12',
        creative: {
          instagram_permalink_url: 'https://www.instagram.com/p/SomethingElse/',
        },
      },
    })
    await f.request('POST')
    const result = await (
      await f.mf.dispatchFetch('https://mock.test/api/meta-ads')
    ).json()
    assert.equal(result.status, 'ready')
    assert.equal(result.daily.length, 2)
    assert.equal(result.daily[0].reviewedAdId, undefined)
    assert.match(result.daily[1].reviewedAdId, /^meta-/)
    assert.deepEqual(
      result.cards.map((card) => card.id),
      [result.daily[1].reviewedAdId],
    )
    assert.deepEqual(result.adPeriods, [])
  } finally {
    await f.mf.dispose()
  }
})

test('retains verified post identity through a creative lookup failure and keeps the previous snapshot on a period failure', async () => {
  const f = await fixture()
  const read = async () =>
    (await f.mf.dispatchFetch('https://mock.test/api/meta-ads')).json()
  try {
    await reviewedCard(f, 'card-one', 'One')
    const ads = (code) => ({
      11: {
        id: '11',
        creative: {
          instagram_permalink_url: 'https://www.instagram.com/p/' + code + '/',
        },
      },
      12: {
        id: '12',
        creative: {
          instagram_permalink_url: 'https://www.instagram.com/p/Separate/',
        },
      },
    })
    const perAd = [{ ad_id: '11', impressions: '10', spend: '100', reach: '5' }]
    f.success('100')
    creativeQuery(f).reply(200, ads('One'))
    mockAdPeriods(f, perAd)
    await f.request('POST')
    assert.equal(
      (await read()).adPeriods.filter((row) => row.reviewedAdId === 'card-one')
        .length,
      2,
    )

    f.success('120')
    creativeQuery(f).reply(503, { error: { code: 2 } })
    mockAdPeriods(f, [{ ...perAd[0], spend: '120' }])
    await f.request('POST')
    const latest = await read()
    assert.equal(latest.status, 'ready')
    assert.equal(latest.daily[0].reviewedAdId, 'card-one')
    assert.equal(
      latest.adPeriods.find((row) => row.reviewedAdId === 'card-one').spend,
      120,
    )
    assert.equal('verifiedPostCode' in latest.daily[0], false)

    f.success('190')
    creativeQuery(f).reply(200, ads('One'))
    f.intercept(/\/insights\?.*level=ad/).reply(503, { error: { code: 2 } })
    await f.request('POST')
    assert.deepEqual(await read(), { ...latest, status: 'error' })

    f.success('200')
    creativeQuery(f).reply(200, ads('Different'))
    mockAdPeriods(f, perAd)
    await f.request('POST')
    const changed = await read()
    assert.equal(changed.status, 'ready')
    assert.ok(changed.adPeriods.every((row) => row.reviewedAdId !== 'card-one'))
    assert.match(changed.daily[0].reviewedAdId, /^meta-/)
  } finally {
    await f.mf.dispose()
  }
})
