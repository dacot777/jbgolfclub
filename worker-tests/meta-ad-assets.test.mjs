import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const key = 'meta-abcdef12-3456-4867-a111-123456789abc'
const bundle = await build({
  stdin: {
    contents: `import {discoverInstagramAds, syncMetaAdThumbnail} from './worker/meta-ad-assets.ts';
      import worker from './worker/index.ts';
      export default {async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/discover') return Response.json(await discoverInstagramAds(env, '1234', url.searchParams.has('many')?['91','92','93']:['91','92'], new Date('2026-11-11T00:00:00Z')));
        if (url.pathname === '/sync') return Response.json(await syncMetaAdThumbnail(env, '${key}', url.searchParams.get('source'), url.searchParams.get('creative')));
        return worker.fetch(request, env);
      }}`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  write: false,
})

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
      META_AD_ACCOUNT_ID: '1234',
      META_ADS_API_VERSION: 'v26.0',
      META_ADS_ACCESS_TOKEN: 'test-only-reader',
    },
  })
  const db = await mf.getD1Database('DB')
  const migrations = await Promise.all(
    ['0005_meta_ads.sql', '0006_meta_ad_registry.sql'].map((file) =>
      readFile('worker/migrations/' + file, 'utf8'),
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
  const call = (path) => mf.dispatchFetch('https://unit.test' + path)
  return { mf, mock, db, call }
}

test('discovers scheduled and active Instagram assets before delivery, refreshes inherited pauses, and leaves ambiguous or expired inventory out', async () => {
  const { mf, mock, call } = await fixture()
  try {
    const graph = mock.get('https://graph.facebook.com')
    const hdrs = { authorization: 'Bearer test-only-reader' }
    const ad = (id, changes = {}) => ({
      id,
      name: 'Instagram post',
      effective_status: 'ACTIVE',
      adset: {
        targeting: { publisher_platforms: ['instagram'] },
        effective_status: 'ACTIVE',
      },
      ...changes,
    })
    graph
      .intercept({ path: /^\/v26\.0\/act_1234\/ads\?/, headers: hdrs })
      .reply(200, {
        data: [
          ad('1', {
            created_time: '2026-10-16T14:00:00+0900',
            campaign: { id: '120', effective_status: 'ACTIVE' },
            creative: {
              id: '900',
              instagram_permalink_url:
                'https://www.instagram.com/p/CaseSensitive123/?x=y',
              thumbnail_url: 'https://cdn.xx.fbcdn.net/post.jpg?sig=serverOnly',
            },
          }),
          ad('2', {
            effective_status: 'PENDING_REVIEW',
            adset: {
              start_time: '2026-12-04T10:00:00+0900',
              targeting: { publisher_platforms: ['instagram'] },
            },
          }),
          ad('3', {
            adset: { targeting: { publisher_platforms: ['facebook'] } },
            creative: {
              instagram_permalink_url: 'https://www.instagram.com/p/FBOnly/',
            },
          }),
          ad('4', { adset: { targeting: {} } }),
          ad('5', {
            adset: {
              end_time: '2026-09-01T00:00:00+0900',
              targeting: { publisher_platforms: ['instagram'] },
            },
          }),
          ad('6', { campaign: { effective_status: 'PAUSED' } }),
        ],
        paging: {
          next: 'https://hostile.test/ignored',
          cursors: { after: 'cursor' },
        },
      })
    graph
      .intercept({ path: /\/ads\?.*after=cursor/, headers: hdrs })
      .reply(200, {
        data: [
          ad('7', {
            adset: {},
            creative: {
              instagram_permalink_url:
                'https://instagram.com/brand/reel/AnotherCode/',
            },
          }),
        ],
      })
    graph.intercept({ path: /^\/v26\.0\/91\?/, headers: hdrs }).reply(
      200,
      ad('91', {
        created_time: '2026-10-11T00:00:00+0900',
        adset: { id: '190', effective_status: 'PAUSED' },
      }),
    )
    graph
      .intercept({ path: /^\/v26\.0\/92\?/, headers: hdrs })
      .reply(200, ad('92', { effective_status: 'ARCHIVED' }))
    const statusEvent = (
      objectId,
      eventType,
      oldValue,
      newValue,
      time = '2026-11-09T12:30:00+0900',
    ) => ({
      object_id: objectId,
      event_type: eventType,
      event_time: time,
      extra_data: JSON.stringify({
        type: 'run_status',
        old_value: oldValue,
        new_value: newValue,
        ...(newValue === 'Inactive' && oldValue === 'Active'
          ? { run_status: { old_value: 1, new_value: 15 } }
          : {}),
      }),
    })
    graph
      .intercept({ path: /^\/v26\.0\/act_1234\/activities\?/, headers: hdrs })
      .reply(200, {
        data: [
          statusEvent('120', 'update_campaign_run_status', 'Active', 'Paused'),
          statusEvent(
            '120',
            'update_campaign_run_status',
            'Active',
            'Paused',
            '2026-10-10T12:00:00+0900',
          ),
          statusEvent(
            '190',
            'update_ad_set_run_status',
            'Active',
            'Inactive',
            '2026-11-06T12:00:00+0900',
          ),
          statusEvent(
            '190',
            'update_ad_set_run_status',
            'Active',
            'Inactive',
            '2026-11-04T12:00:00+0900',
          ),
          statusEvent(
            '91',
            'update_ad_run_status',
            'Pending Process',
            'Active',
          ),
          statusEvent('1', 'update_ad_run_status', 'Paused', 'Active'),
          statusEvent('7', 'update_ad_run_status', 'Active', 'Inactive'),
          statusEvent('7', 'update_ad_run_status', 'Paused', 'Paused'),
          statusEvent(
            '7',
            'update_ad_run_status',
            'Active',
            'Paused',
            'invalid',
          ),
          statusEvent(
            '2',
            'update_ad_run_status',
            'Active',
            'Paused',
            '2026-12-30T12:30:00+0900',
          ),
          statusEvent('92', 'update_campaign_budget', 'Active', 'Paused'),
          statusEvent('777', 'update_ad_run_status', 'Active', 'Paused'),
        ],
      })
    const result = await (await call('/discover')).json()
    assert.deepEqual(
      result.map((row) => [row.adId, row.status]),
      [
        ['1', 'active'],
        ['2', 'scheduled'],
        ['7', 'active'],
        ['91', 'paused'],
        ['92', 'archived'],
      ],
    )
    assert.equal(
      result[0].postUrl,
      'https://www.instagram.com/p/CaseSensitive123/',
    )
    assert.equal(result[0].creativeId, '900')
    assert.equal(
      result[2].postUrl,
      'https://www.instagram.com/reel/AnotherCode/',
    )
    assert.equal(result[3].instagram, true)
    assert.equal(result[0].createdAt, '2026-10-16T05:00:00.000Z')
    assert.equal(result[1].startAt, '2026-12-04T01:00:00.000Z')
    assert.deepEqual(
      result.map((row) => row.pauseEvents ?? []),
      [
        [{ at: '2026-11-09T03:30:00.000Z', source: 'meta' }],
        [],
        [],
        [{ at: '2026-11-06T03:00:00.000Z', source: 'meta' }],
        [],
      ],
    )
  } finally {
    await mf.dispose()
  }
})

test('recovers individually readable known ads from an incomplete batch, without forwarding credentials off Meta', async () => {
  const { mf, mock, call } = await fixture()
  try {
    const graph = mock.get('https://graph.facebook.com')
    const old = (id) => ({ id, name: 'Past ad', effective_status: 'PAUSED' })
    graph.intercept({ path: /\/ads\?/ }).reply(200, { data: [] })
    graph
      .intercept({ path: /^\/v26\.0\/\?.*ids=/ })
      .reply(200, { 91: old('91') })
    graph.intercept({ path: /^\/v26\.0\/92\?/ }).reply(200, old('92'))
    graph
      .intercept({ path: /^\/v26\.0\/93\?/ })
      .reply(400, { error: { code: 100 } })
    graph.intercept({ path: /^\/v26\.0\/93\?/ }).reply(200, old('93'))
    graph.intercept({ path: /\/activities\?/ }).reply(200, { data: [] })
    const rows = await (await call('/discover?many')).json()
    assert.deepEqual(rows.map((row) => row.adId).sort(), ['91', '92', '93'])
    assert.ok(rows.every((row) => row.status === 'paused'))
  } finally {
    await mf.dispose()
  }
})

test('stores genuine image bytes only, keeps them when Meta cannot replace them, and serves without signed source or account identifiers', async () => {
  const { mf, mock, db, call } = await fixture()
  try {
    const cdn = mock.get('https://cdn.xx.fbcdn.net')
    const original = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64',
    )
    cdn
      .intercept({ path: '/old?sig=temp' })
      .reply(200, original, { headers: { 'Content-Type': 'image/gif' } })
    const sync = async (url, id) =>
      (
        await call(
          '/sync?' + new URLSearchParams({ source: url, creative: id }),
        )
      ).json()
    assert.equal(
      await sync('https://cdn.xx.fbcdn.net/old?sig=temp', '811'),
      true,
    )
    // A previously stored creative still works when the signed CDN link expires.
    assert.equal(await sync('https://cdn.xx.fbcdn.net/expired', '811'), true)
    cdn.intercept({ path: '/redirect' }).reply(302, '', {
      headers: { location: 'https://hostile.test/image.jpg' },
    })
    assert.equal(await sync('https://cdn.xx.fbcdn.net/redirect', '812'), true)
    cdn.intercept({ path: '/fake' }).reply(200, '<svg onload="alert(1)"/>', {
      headers: { 'Content-Type': 'image/png' },
    })
    assert.equal(await sync('https://cdn.xx.fbcdn.net/fake', '813'), true)
    cdn.intercept({ path: '/oversize' }).reply(200, Buffer.alloc(300 * 1024, 1))
    assert.equal(await sync('https://cdn.xx.fbcdn.net/oversize', '814'), true)
    const publicUrl = '/api/meta-ads/thumbnail/' + key
    const photo = await call(publicUrl)
    assert.equal(photo.status, 200)
    assert.equal(photo.headers.get('content-type'), 'image/gif')
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), original)
    assert.equal(
      (
        await db
          .prepare(
            'SELECT creative_id AS c FROM meta_ad_thumbnails WHERE public_key=?',
          )
          .bind(key)
          .first()
      ).c,
      '811',
    )
    await db.prepare("UPDATE meta_ad_thumbnails SET account_id='8765'").run()
    assert.equal((await call(publicUrl)).status, 404)
    assert.equal((await call('/api/meta-ads/thumbnail/1234')).status, 404)
  } finally {
    await mf.dispose()
  }
})
