import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const at = '2026-11-11T16:00:00.000Z'
const day = '2026-11-12'
const account = '72100433'
const token = 'synthetic-lifetime-test-reader'
const bundle = await build({
  stdin: {
    contents: `import worker from './worker/index.ts';
      import { readMetaLifetime } from './worker/meta-lifetime.ts';
      export default { async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/clock') return Response.json(await readMetaLifetime(env, new Date(url.searchParams.get('at'))));
        return worker.fetch(request, env);
      } }`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  write: false,
})

async function fixture(t) {
  const mock = createFetchMock()
  mock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    fetchMock: mock,
    bindings: {
      META_AD_ACCOUNT_ID: account,
      META_ADS_ACCESS_TOKEN: token,
      META_ADS_API_VERSION: 'v26.0',
    },
  })
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  const migrations = await Promise.all(
    ['0005_meta_ads', '0006_meta_ad_registry', '0007_meta_ad_lifetime'].map(
      (name) => readFile('worker/migrations/' + name + '.sql', 'utf8'),
    ),
  )
  await db.batch(
    migrations
      .join('\n')
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  )
  await db
    .prepare(
      'INSERT INTO meta_ads_sync(account_id,currency,time_zone) VALUES(?,?,?)',
    )
    .bind(account, 'KRW', 'Asia/Seoul')
    .run()
  const add = (
    adId,
    cardId,
    created = '2026-10-16T18:00:00Z',
    suppressed = 0,
  ) =>
    db
      .prepare(
        'INSERT INTO meta_ad_registry(account_id,ad_id,public_key,reviewed_id,title,status,created_at,suppressed) VALUES(?,?,?,?,?,?,?,?)',
      )
      .bind(
        account,
        adId,
        'private-registry-key-' + adId,
        cardId,
        'Synthetic campaign internal title',
        'active',
        created,
        suppressed,
      )
      .run()
  const insights = () =>
    mock.get('https://graph.facebook.com').intercept({
      path: new RegExp('^/v26\\.0/act_' + account + '/insights\\?'),
      method: 'GET',
      headers: { authorization: 'Bearer ' + token },
    })
  const call = async (when = at) =>
    (
      await mf.dispatchFetch(
        'https://unit.test/clock?at=' + encodeURIComponent(when),
      )
    ).json()
  return { db, add, insights, call, mf }
}

function row(adId, overrides = {}) {
  return {
    ad_id: adId,
    date_start: '2026-10-17',
    date_stop: day,
    publisher_platform: 'instagram',
    spend: '203',
    impressions: '70',
    inline_link_clicks: '0',
    reach: '51',
    ...overrides,
  }
}

test('publishes only scoped Instagram lifetime metrics and leaves overlapping multi-ad reach unknown', async (t) => {
  const { add, insights, call, mf, db } = await fixture(t)
  const first = '99000111',
    second = '99000222',
    other = '99000333',
    hidden = '99000444'
  await Promise.all([
    add(first, 'post-one'),
    add(second, 'post-one'),
    add(other, 'post-two'),
    add(hidden, 'post-hidden', null, 1),
  ])
  insights().reply(200, ({ path }) => {
    const params = new URL(path, 'https://unit.test').searchParams
    assert.deepEqual(JSON.parse(params.get('time_range')), {
      since: '2026-10-17',
      until: day,
    })
    assert.deepEqual(JSON.parse(params.get('filtering')), [
      { field: 'ad.id', operator: 'IN', value: [first, second, other] },
    ])
    assert.equal(params.get('level'), 'ad')
    assert.equal(params.get('breakdowns'), 'publisher_platform')
    return {
      data: [
        row(first),
        row(second, {
          spend: '17',
          impressions: '50',
          inline_link_clicks: '4',
          reach: '41',
        }),
        row(other, { reach: '27' }),
        row(first, { publisher_platform: 'facebook', spend: '999999' }),
      ],
    }
  })
  const report = await call()
  assert.equal(report.status, 'ready')
  assert.equal(report.asOf, at)
  assert.equal(report.currency, 'KRW')
  assert.equal(report.totals.length, 2)
  const one = report.totals.find((item) => item.reviewedAdId === 'post-one')
  assert.deepEqual(
    [one.spend, one.impressions, one.linkClicks, one.reach, one.complete],
    [220, 120, 4, null, true],
  )
  const two = report.totals.find((item) => item.reviewedAdId === 'post-two')
  assert.deepEqual(
    [two.spend, two.linkClicks, two.reach, two.since, two.until],
    [203, 0, 27, '2026-10-17', day],
  )
  // Keep the public route deterministic even on hosts with a different system clock.
  await db
    .prepare('UPDATE meta_ad_lifetime_cache SET next_attempt=?')
    .bind(Date.now() + 60000)
    .run()
  const publicResponse = await mf.dispatchFetch(
    'https://unit.test/api/meta-ads/lifetime',
  )
  assert.equal(publicResponse.status, 200)
  const wire = await publicResponse.text()
  assert.deepEqual(JSON.parse(wire), report)
  for (const privateValue of [
    account,
    token,
    first,
    second,
    other,
    hidden,
    'Synthetic campaign internal title',
    'post-hidden',
    'private-registry-key',
  ])
    assert.ok(!wire.includes(privateValue))
})

test('keeps Meta-provided lookback bounds explicit for older and unknown ad starts', async (t) => {
  const { add, insights, call } = await fixture(t)
  await add('881100', 'old-post', '2019-04-07T00:00:00Z')
  await add('881101', 'unknown-post', null)
  insights().reply(200, ({ path }) => {
    const params = new URL(path, 'https://unit.test').searchParams
    assert.equal(params.get('date_preset'), 'maximum')
    assert.equal(params.has('time_range'), false)
    return {
      data: [
        row('881100', { date_start: '2023-11-15' }),
        row('881101', { date_start: '2024-02-03' }),
      ],
    }
  })
  const report = await call()
  assert.equal(report.status, 'ready')
  assert.deepEqual(
    report.totals.map((r) => [r.reviewedAdId, r.since, r.until, r.complete]),
    [
      ['old-post', '2023-11-15', day, false],
      ['unknown-post', '2024-02-03', day, false],
    ],
  )
})

test('retains the last successful amount and timestamp after an upstream failure and retries after the cooldown', async (t) => {
  const { add, insights, call } = await fixture(t)
  await add('771100', 'public-post')
  insights().reply(200, { data: [row('771100')] })
  const good = await call()
  assert.equal(good.status, 'ready')
  assert.deepEqual(await call('2026-11-11T16:00:30Z'), good)
  insights().reply(503, { error: { message: 'private upstream detail' } })
  const stale = await call('2026-11-11T16:01:01Z')
  assert.equal(stale.status, 'error')
  assert.equal(stale.asOf, good.asOf)
  assert.deepEqual(stale.totals, good.totals)
  assert.ok(!JSON.stringify(stale).includes('private upstream detail'))
  assert.deepEqual(await call('2026-11-11T16:01:30Z'), stale)
  insights().reply(200, { data: [row('771100', { spend: '456' })] })
  const recovered = await call('2026-11-11T16:02:02Z')
  assert.equal(recovered.status, 'ready')
  assert.equal(recovered.totals[0].spend, 456)
  assert.equal(recovered.asOf, '2026-11-11T16:02:02.000Z')
})

test('a missing placement row keeps its previous figures dated and leaves a newly discovered ad without a made-up zero', async (t) => {
  const { add, insights, call } = await fixture(t)
  await add('771101', 'shared-post')
  await add('771102', 'shared-post')
  insights().reply(200, { data: [row('771101'), row('771102')] })
  const first = await call()
  assert.equal(first.totals[0].complete, true)
  await add('771103', 'scheduled-post')
  insights().reply(200, { data: [row('771101', { spend: '306' })] })
  const next = await call('2026-11-11T16:01:03Z')
  assert.equal(next.totals.length, 1)
  const [partial] = next.totals
  assert.equal(partial.reviewedAdId, 'shared-post')
  assert.equal(partial.spend, 509)
  assert.equal(partial.complete, false)
  assert.equal(partial.asOf, first.asOf)
  assert.equal(partial.reach, null)
})
