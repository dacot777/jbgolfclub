import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

async function setup(t) {
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
  return { db, mf, base }
}

async function migrateInquiries(db) {
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
}

test('public inquiry totals group only approved categories and never read private fields', async (t) => {
  const { db, mf, base } = await setup(t)
  const url = base + '/api/inquiries/summary'
  const get = () => mf.dispatchFetch(url)
  const unavailable = await get()
  assert.equal(unavailable.status, 503)
  assert.deepEqual(await unavailable.json(), {
    error: { code: 'inquiries_unavailable' },
  })
  assert.equal(unavailable.headers.get('cache-control'), 'no-store')
  await migrateInquiries(db)
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

test('public inquiry list returns each inquiry in staff display order with only the seven authorized fields', async (t) => {
  const { db, mf, base } = await setup(t)
  const url = base + '/api/inquiries/list'
  const get = () => mf.dispatchFetch(url)
  const unavailable = await get()
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await unavailable.json(), {
    error: { code: 'inquiries_unavailable' },
  })
  await migrateInquiries(db)
  assert.deepEqual(await (await get()).json(), { rows: [] })

  const insert = db.prepare(
    `INSERT INTO inquiries (id,created_at,first_date,product,branch,channel,source,assignee,stage,ad_id,private_fields,creation_fingerprint,customer_type) VALUES (?,?,?,'camp',?,'kakao','instagram_ad','kim_yeoul',?,'sensitive-ad-link','encrypted sample','private fingerprint','junior')`,
  )
  const older = randomUUID()
  const newer = randomUUID()
  await db.batch([
    insert.bind(older, 1, '2024-02-29', 'hanam', 'received'),
    insert.bind(randomUUID(), 2, '2024-02-29', 'hanam', 'received'),
    insert.bind(newer, 2, '2026-02-30', null, 'consulting'),
  ])
  const response = await mf.dispatchFetch(
    url + '?fields=contact,name,note,id,adId',
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('set-cookie'), null)
  const row = {
    firstDate: '2024-02-29',
    product: 'camp',
    branch: 'hanam',
    channel: 'kakao',
    source: 'instagram_ad',
    assignee: 'kim_yeoul',
    stage: 'received',
  }
  assert.deepEqual(await response.json(), {
    rows: [
      { ...row, firstDate: null, branch: null, stage: 'consulting' },
      row,
      row,
    ],
  })
  await db
    .prepare("UPDATE inquiries SET stage='closed' WHERE id=?")
    .bind(older)
    .run()
  await db.prepare('DELETE FROM inquiries WHERE id=?').bind(newer).run()
  assert.deepEqual(await (await get()).json(), {
    rows: [row, { ...row, stage: 'closed' }],
  })
  assert.equal(
    (await mf.dispatchFetch(base + '/api/admin/inquiries')).status,
    401,
  )
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await mf.dispatchFetch(url, { method })).status, 404)
  }

  // Model an old dataset with unrecognized text in every column; keep the row
  // in the report while preventing any of that text from appearing in public.
  await db.prepare('ALTER TABLE inquiries RENAME TO original_inquiries').run()
  await db
    .prepare(
      `CREATE TABLE inquiries AS SELECT 'private date' AS first_date, 'private product' AS product,
       'private branch' AS branch, 'private channel' AS channel, 'private source' AS source,
       'private assignee' AS assignee, 'private stage' AS stage, 1 AS created_at`,
    )
    .run()
  assert.deepEqual(await (await get()).json(), {
    rows: [
      {
        firstDate: null,
        product: null,
        branch: null,
        channel: null,
        source: null,
        assignee: null,
        stage: null,
      },
    ],
  })
})
