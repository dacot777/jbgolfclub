import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

test('visitors read published media and plans without revealing editing data or gaining write access', async (t) => {
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
  for (const name of ['0010_calendar_schedules', '0011_calendar_instagram']) {
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
      date: '2028-02-28',
      id: scheduleId,
      kind: 'post',
      note: '',
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
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const path of ['/api/calendar?month=2028-02', reel.thumbnailUrl])
      assert.equal((await request(path, method)).status, 405)
  }
  assert.equal(
    (await request('/api/calendar/schedules/' + scheduleId, 'DELETE')).status,
    404,
  )
  const preserved = await db
    .prepare('SELECT note FROM calendar_schedules WHERE id=?')
    .bind(scheduleId)
    .first()
  assert.equal(preserved.note, privateData.note)
})
