import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

test('public inquiry totals group only approved categories and never read private fields', async (t) => {
  const bundle = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  })
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
  })
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  const base = 'https://public-inquiries.test'
  const url = base + '/api/inquiries/summary'
  const get = () => mf.dispatchFetch(url)
  const unavailable = await get()
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), {
    error: { code: 'inquiries_unavailable' },
  })
  assert.equal(unavailable.headers.get('cache-control'), 'no-store')
  for (const name of [
    '0008_inquiries',
    '0009_inquiry_branches',
    '0015_inquiry_customer_type',
  ]) {
    const sql = await readFile('worker/migrations/' + name + '.sql', 'utf8')
    await db.batch(
      sql
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => db.prepare(part)),
    )
  }
  assert.deepEqual(await (await get()).json(), { rows: [] })
  const insert = db.prepare(
    `INSERT INTO inquiries (id, product, branch, channel, stage, customer_type, assignee, private_fields)
     VALUES (?, ?, ?, ?, ?, ?, 'kim_uihyeon', 'not decryptable personal information')`,
  )
  const first = randomUUID()
  await db.batch([
    insert.bind(first, 'camp', null, 'kakao', 'received', 'junior'),
    insert.bind(randomUUID(), 'camp', null, 'kakao', 'received', 'adult'),
    insert.bind(randomUUID(), 'lesson', 'hanam', 'phone', 'consulting', null),
  ])
  const response = await mf.dispatchFetch(
    url + '?fields=id,name,private_fields&contact=1',
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  assert.match(response.headers.get('cache-control'), /s-maxage=30/)
  assert.deepEqual(await response.json(), {
    rows: [
      {
        product: 'camp',
        branch: null,
        channel: 'kakao',
        stage: 'received',
        count: 2,
      },
      {
        product: 'lesson',
        branch: 'hanam',
        channel: 'phone',
        stage: 'consulting',
        count: 1,
      },
    ],
  })
  assert.equal(
    (await mf.dispatchFetch(base + '/api/admin/inquiries')).status,
    401,
  )
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await mf.dispatchFetch(url, { method })).status, 404)
  }
  await db.prepare('DELETE FROM inquiries WHERE id=?').bind(first).run()
  assert.equal((await (await get()).json()).rows[0].count, 1)
  await db
    .prepare("UPDATE inquiries SET stage='closed' WHERE product='camp'")
    .run()
  assert.equal((await (await get()).json()).rows[0].stage, 'closed')
  // A prior or malformed dataset may not enforce today's enum constraints.
  await db.prepare('ALTER TABLE inquiries RENAME TO valid_inquiries').run()
  await db
    .prepare(
      `CREATE VIEW inquiries AS SELECT product, branch, channel, stage FROM valid_inquiries
       UNION ALL SELECT 'unexpected product',NULL,'kakao','received'
       UNION ALL SELECT 'camp','unexpected branch','kakao','received'
       UNION ALL SELECT 'camp',NULL,'unexpected channel','received'
       UNION ALL SELECT 'camp',NULL,'kakao','unexpected stage'`,
    )
    .run()
  const filtered = await (await get()).json()
  assert.equal(filtered.rows.length, 2)
  assert.equal(JSON.stringify(filtered).includes('unexpected'), false)
})
