import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

test('visitors read published media and plans without revealing private notes or account data', async (t) => {
  const origin = 'https://public-calendar.test'
  const bundle = await build({
    entryPoints: ['worker/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
  })
  const network = createFetchMock()
  network.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    bindings: { APP_ORIGIN: origin },
    fetchMock: network,
  })
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  for (const name of [
    '0010_calendar_schedules',
    '0011_calendar_instagram',
    '0014_calendar_links',
    '0016_calendar_brands',
    '0017_instagram_gallery_indexes',
    '0018_calendar_schedule_kinds',
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
  const scheduleId = 'f0000000-0000-4000-8000-000000000001'
  const publicAccount = 'jbgolfacademy'
  const privateData = {
    note: 'staff-only editing instructions',
    fingerprint: 'fixture-creation-fingerprint',
    grant: 'fixture-encrypted-grant',
    accountId: '98810000000000001',
    cursor: 'private-fetch-cursor',
  }
  const cover = 'https://scontent.cdninstagram.com/cover.jpg'
  const addMedia = db.prepare(
    "INSERT INTO calendar_instagram_media(id,account,kind,title,date,time,permalink,thumbnail_url,thumbnail_checked_at,seen_at) VALUES(?,?,'reel','Reel','2028-02-29','08:15','https://www.instagram.com/reel/test/',?,?,?)",
  )
  const now = Date.now()
  await db.batch([
    db
      .prepare(
        'INSERT INTO calendar_instagram_accounts(account,user_id,encrypted_token,after_cursor,token_expires_at,refreshed_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        publicAccount,
        privateData.accountId,
        privateData.grant,
        privateData.cursor,
        now + 900000,
        now,
      ),
    addMedia.bind('90001', publicAccount, cover, now, now),
    addMedia.bind(
      '90002',
      publicAccount,
      cover + '?access_token=secret',
      now,
      now,
    ),
    db
      .prepare(
        "INSERT INTO calendar_schedules(id,account,kind,day,title,note,creation_fingerprint) VALUES(?,?,'post','2028-02-28','Tournament',?,?)",
      )
      .bind(
        scheduleId,
        publicAccount,
        privateData.note,
        privateData.fingerprint,
      ),
  ])
  const request = (path, method = 'GET') =>
    mf.dispatchFetch(origin + path, { method, redirect: 'manual' })
  const response = await request('/api/calendar?month=2028-02')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('set-cookie'), null)
  const month = await response.json()
  for (const value of Object.values(privateData))
    assert.equal(JSON.stringify(month).includes(value), false)
  assert.deepEqual(month.schedules, [
    {
      account: publicAccount,
      brand: 'academy',
      branch: null,
      date: '2028-02-28',
      id: scheduleId,
      kind: 'post',
      note: '',
      permalink: null,
      time: null,
      title: 'Tournament',
      version: 1,
    },
  ])
  assert.deepEqual(
    month.accounts.map((item) => item.account),
    [publicAccount, 'jbgolfclub_official', 'jbgolfclub_bundang'],
  )
  const reel = month.posts.find((item) => item.id === '90001')
  assert.equal(reel.thumbnailUrl, '/api/calendar/thumbnail/90001')
  const thumbnail = await request(reel.thumbnailUrl)
  assert.equal(thumbnail.status, 302)
  assert.equal(thumbnail.headers.get('location'), cover)
  assert.equal(thumbnail.headers.get('set-cookie'), null)
  assert.equal((await request('/api/calendar/thumbnail/90002')).status, 404)
  assert.equal((await request('/api/calendar/thumbnail/unknown')).status, 404)
  assert.equal((await request('/api/calendar?month=2028-99')).status, 400)
  const nextMonth = await (await request('/api/calendar?month=2028-03')).json()
  assert.deepEqual(nextMonth.posts, [])
  assert.deepEqual(nextMonth.schedules, [])
  // Staff assigned this short code to March. The timestamp from Instagram places it in February.
  await db
    .prepare(
      "UPDATE calendar_schedules SET day='2028-03-02', permalink='https://www.instagram.com/p/test/' WHERE id=?",
    )
    .bind(scheduleId)
    .run()
  const matched = await (await request('/api/calendar?month=2028-02')).json()
  assert.deepEqual(
    matched.schedules.map(({ date, time, permalink, note }) => ({
      date,
      time,
      permalink,
      note,
    })),
    [
      {
        date: '2028-02-29',
        time: '08:15',
        permalink: 'https://www.instagram.com/p/test/',
        note: '',
      },
    ],
  )
  assert.deepEqual(
    (await (await request('/api/calendar?month=2028-03')).json()).schedules,
    [],
  )
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of [
      '/api/calendar?month=2028-02',
      '/api/calendar/posts',
      reel.thumbnailUrl,
    ])
      assert.equal((await request(path, method)).status, 405)
  }
  assert.equal(
    (await request('/api/calendar/schedules/' + scheduleId, 'DELETE')).status,
    403,
  )
  const preserved = await db
    .prepare('SELECT note FROM calendar_schedules WHERE id=?')
    .bind(scheduleId)
    .first()
  assert.equal(preserved.note, privateData.note)

  await t.test(
    'public calendar shows planned work with its selected kind, including blog uploads, without publishing it to Instagram',
    async () => {
      const kinds = ['shoot', 'upload_post', 'upload_reel', 'upload_blog']
      const addPlan = db.prepare(`INSERT INTO calendar_schedules
      (id,scheduled_brand,kind,title,day,note,creation_fingerprint)
      VALUES(?,'haus',?,'Scheduled work',?,?,?)`)
      await db.batch(
        kinds.map((kind, index) =>
          addPlan.bind(
            randomUUID(),
            kind,
            '2035-01-0' + (index + 1),
            privateData.note,
            privateData.fingerprint,
          ),
        ),
      )
      const publicMonth = await (
        await request('/api/calendar?month=2035-01')
      ).json()
      assert.deepEqual(publicMonth.posts, [])
      assert.deepEqual(
        publicMonth.schedules.map(({ kind }) => kind),
        kinds,
      )
      assert.ok(
        publicMonth.schedules.every(
          ({ note, permalink }) => note === '' && permalink === null,
        ),
      )
      const gallery = await (await request('/api/calendar/posts')).json()
      assert.ok(gallery.schedules.every(({ kind }) => !kinds.includes(kind)))
    },
  )

  await t.test(
    'latest shows nine distinct publications per account across dates, including independently registered links',
    async () => {
      const addOlder = db.prepare(`INSERT INTO calendar_instagram_media
      (id,account,kind,title,date,time,permalink,thumbnail_checked_at,seen_at)
      VALUES(?,'jbgolfacademy','post','Archive post',?,'12:00',?,0,0)`)
      const addLink = db.prepare(`INSERT INTO calendar_schedules
      (id,account,kind,title,day,note,creation_fingerprint,permalink) VALUES(?,?,'post',?,?,'staff-note','fixture',?)`)
      await db.batch([
        ...Array.from({ length: 15 }, (_, i) =>
          addOlder.bind(
            String(91000 + i),
            '2027-09-' + String(i + 1).padStart(2, '0'),
            'https://www.instagram.com/p/older_' + i + '/',
          ),
        ),
        addLink.bind(
          randomUUID(),
          publicAccount,
          'Newest manual',
          '2028-02-15',
          'https://www.instagram.com/p/standalone/',
        ),
        addLink.bind(
          randomUUID(),
          'jbgolfclub_official',
          'Only official account link',
          '2024-01-10',
          'https://www.instagram.com/p/official/',
        ),
        addLink.bind(
          randomUUID(),
          'jbgolfclub_bundang',
          'Only Bundang link',
          '2023-12-01',
          'https://www.instagram.com/p/bundang/',
        ),
        addLink.bind(
          randomUUID(),
          'jbgolfclub_bundang',
          'Unpublished plan',
          '2029-02-20',
          null,
        ),
        // Manually placing this old media in a recent month cannot displace a newer publication.
        addLink.bind(
          randomUUID(),
          publicAccount,
          'Old matched link',
          '2029-01-01',
          'https://www.instagram.com/p/older_0/',
        ),
      ])
      const latestResponse = await request('/api/calendar/posts')
      assert.equal(latestResponse.status, 200)
      assert.equal(latestResponse.headers.get('set-cookie'), null)
      const latest = await latestResponse.json()
      assert.equal(latest.month, 'latest')
      assert.deepEqual(latest.accounts, month.accounts)
      // Two media IDs with the same permalink are one published item. Its attached
      // editable registration keeps its originally assigned date while the
      // linked Instagram post supplies the authoritative display timestamp.
      assert.deepEqual(
        latest.posts.map((p) => p.id),
        [
          '90002',
          '91014',
          '91013',
          '91012',
          '91011',
          '91010',
          '91009',
          '91008',
        ],
      )
      assert.deepEqual(
        latest.schedules.map((s) => [s.title, s.date, s.note]),
        [
          ['Tournament', '2028-03-02', ''],
          ['Newest manual', '2028-02-15', ''],
          ['Only official account link', '2024-01-10', ''],
          ['Only Bundang link', '2023-12-01', ''],
        ],
      )
      for (const value of [
        ...Object.values(privateData),
        cover,
        'staff-note',
        'Unpublished plan',
        'Old matched link',
      ])
        assert.equal(JSON.stringify(latest).includes(value), false)
    },
  )
})
