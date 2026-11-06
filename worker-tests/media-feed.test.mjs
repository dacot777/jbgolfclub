import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const origin = 'https://jb-golf.test'
const now = Date.parse('2026-11-06T02:00:00Z')
const keywords = [
  'JB GOLF CLUB',
  'JB골프클럽',
  '제이비골프클럽',
  'JB골프클럽청담점',
  'JB골프클럽서현점',
  'JB아카데미',
  'JB골프아카데미',
  'JB GOLF ACADEMY',
  'JB ACADEMY',
]

// This harness supplies virtual time and synthetic search results; production
// requests cannot choose a provider, clock, fixture, or arbitrary external URL.
const bundle = await build({
  stdin: {
    contents: `
      import { mediaFeed } from './worker/media-feed'
      import { COMPANY_MEDIA_KEYWORDS } from './src/lib/media-types'
      export default {
        async fetch(request, env) {
          const url = new URL(request.url)
          const clock = Number(url.searchParams.get('clock') || ${now})
          const generation = url.searchParams.get('generation') || '1'
          const mode = url.searchParams.get('mode') || 'normal'
          const search = async (kind, keyword) => {
            await env.DB.prepare('INSERT INTO test_media_calls(kind,keyword,called_at) VALUES(?,?,?)')
              .bind(kind, keyword, clock).run()
            const index = COMPANY_MEDIA_KEYWORDS.indexOf(keyword)
            if (mode === 'throw' || (mode === 'one-error' && index === 0)) throw new Error('Synthetic source unavailable')
            if (mode === 'empty') return []
            const publisher = kind === 'blog' ? '독립 블로거 검증소' : '독립 검증 매체'
            const candidate = (path, publishedAt, title) => ({
              title, url: 'https://example.com/' + kind + '/' + path,
              publisher, author: kind === 'blog' ? '외부 필자' : null,
              thumbnailUrl: null, publishedAt, matchedKeywords: [keyword],
              searchText: keyword + ' JB골프클럽 검증 자료',
            })
            return [
              candidate('shared', null, 'JB골프클럽 공통 검증 게시물'),
              candidate('g' + generation + '/' + index,
                index % 2 ? '2026-11-05T01:00:00.000Z' : null,
                keyword + ' 개별 검증 게시물'),
            ]
          }
          return mediaFeed(request, env.DB, search, () => clock)
        },
      }
    `,
    resolveDir: process.cwd(),
    sourcefile: 'media-feed-test-harness.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const migration = await readFile(
  'worker/migrations/0003_media_monitor.sql',
  'utf8',
)

async function fixture({ withDatabase = true } = {}) {
  const fetchMock = createFetchMock()
  fetchMock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    ...(withDatabase ? { d1Databases: ['DB'] } : {}),
    fetchMock,
  })
  const db = withDatabase ? await mf.getD1Database('DB') : null
  if (db) {
    await db.batch(
      migration
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((sql) => db.prepare(sql)),
    )
    await db
      .prepare(
        'CREATE TABLE test_media_calls (kind TEXT,keyword TEXT,called_at INTEGER)',
      )
      .run()
  }
  return {
    db,
    async request(
      kind = 'news',
      { clock = now, generation = 1, mode = 'normal', method = 'GET' } = {},
    ) {
      const query = new URLSearchParams({
        kind,
        clock: String(clock),
        generation: String(generation),
        mode,
      })
      return mf.dispatchFetch(`${origin}/api/media?${query}`, { method })
    },
    async calls() {
      return (
        await db
          .prepare(
            'SELECT kind,keyword,called_at FROM test_media_calls ORDER BY rowid',
          )
          .all()
      ).results
    },
    async cycle(kind = 'news', options = {}) {
      const steps = []
      for (let step = 0; step < keywords.length; step++) {
        const response = await this.request(kind, options)
        assert.equal(response.status, 200)
        steps.push(await response.json())
      }
      return steps
    },
    dispose: () => mf.dispose(),
  }
}

test('GET 한 번에 한 키워드씩 아홉 별칭을 모두 검색하고 중복 URL을 누적 병합한다', async () => {
  const f = await fixture()
  try {
    let completed
    for (let step = 0; step < keywords.length; step++) {
      const response = await f.request()
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      const data = await response.json()
      assert.equal(data.kind, 'news')
      assert.deepEqual(data.keywords, keywords)
      assert.equal(data.totalQueries, 9)
      assert.equal(data.successfulQueries, step + 1)
      assert.equal(data.refreshing, step < 8)
      assert.equal((await f.calls()).length, step + 1)
      assert.equal(data.items.length, step + 2)
      completed = data
    }
    const calls = await f.calls()
    assert.deepEqual(
      calls.map((call) => call.keyword),
      keywords,
    )
    assert.ok(calls.every((call) => call.kind === 'news'))
    assert.equal(completed.status, 'fresh')
    assert.ok(completed.updatedAt)
    assert.ok(completed.checkedAt)
    assert.equal(completed.items.length, 10)
    const common = completed.items.filter(
      (item) => item.url === 'https://example.com/news/shared',
    )
    assert.equal(common.length, 1)
    assert.deepEqual(
      [...common[0].matchedKeywords].sort(),
      [...keywords].sort(),
    )
    assert.equal(common[0].publishedAt, null)
    assert.ok(Number.isFinite(Date.parse(common[0].firstSeenAt)))
    assert.ok(
      completed.items.some(
        (item) => item.publishedAt === '2026-11-05T01:00:00.000Z',
      ),
    )
  } finally {
    await f.dispose()
  }
})

test('공식 계정이 아닌 독립 블로그 결과도 브랜드 관련성이 있으면 보관한다', async () => {
  const f = await fixture()
  try {
    const steps = await f.cycle('blog')
    const data = steps.at(-1)
    assert.equal(data.kind, 'blog')
    assert.equal(data.status, 'fresh')
    assert.equal(data.successfulQueries, 9)
    assert.equal(data.items.length, 10)
    assert.ok(
      data.items.every(
        (item) =>
          item.publisher === '독립 블로거 검증소' &&
          item.author === '외부 필자',
      ),
    )
    assert.ok(
      data.items.every((item) =>
        item.url.startsWith('https://example.com/blog/'),
      ),
    )
    assert.deepEqual(
      (await f.calls()).map((call) => call.keyword),
      keywords,
    )
  } finally {
    await f.dispose()
  }
})

test('완료 후 30초 이내에는 추가 검색 없이 캐시를 읽고 이후 새 글을 이전 기록에 누적한다', async () => {
  const f = await fixture()
  try {
    const original = (await f.cycle()).at(-1)
    const firstSeen = original.items.find(
      (item) => item.url === 'https://example.com/news/shared',
    ).firstSeenAt
    const cached = await f.request('news', {
      clock: now + 29999,
      generation: 2,
    })
    assert.equal(cached.status, 200)
    const data = await cached.json()
    assert.equal(data.status, 'cached')
    assert.equal(data.refreshing, false)
    assert.equal((await f.calls()).length, 9)
    assert.deepEqual(
      data.items.map((item) => item.url).sort(),
      original.items.map((item) => item.url).sort(),
    )
    const refreshed = (
      await f.cycle('news', { clock: now + 30000, generation: 2 })
    ).at(-1)
    assert.equal((await f.calls()).length, 18)
    assert.equal(refreshed.items.length, 19)
    for (const item of original.items)
      assert.ok(
        refreshed.items.some(
          (next) => next.id === item.id && next.url === item.url,
        ),
      )
    const shared = refreshed.items.find(
      (item) => item.url === 'https://example.com/news/shared',
    )
    assert.equal(shared.firstSeenAt, firstSeen)
    assert.equal(shared.publishedAt, null)
  } finally {
    await f.dispose()
  }
})

test('정상 검색 결과 0건과 검색 실패를 구분하고 실패해도 기존 글과 발행일을 보존한다', async () => {
  const empty = await fixture()
  const failed = await fixture()
  const unavailableSource = await fixture()
  try {
    const zero = (await empty.cycle('news', { mode: 'empty' })).at(-1)
    assert.equal(zero.status, 'fresh')
    assert.equal(zero.successfulQueries, 9)
    assert.deepEqual(zero.items, [])
    const original = (await failed.cycle()).at(-1)
    const unavailable = (
      await failed.cycle('news', { clock: now + 30000, mode: 'throw' })
    ).at(-1)
    assert.equal(unavailable.status, 'cached')
    assert.equal(unavailable.successfulQueries, 0)
    assert.equal(unavailable.refreshing, false)
    assert.equal(unavailable.updatedAt, original.updatedAt)
    assert.deepEqual(unavailable.items, original.items)
    assert.notEqual(unavailable.checkedAt, original.checkedAt)
    const absent = (
      await unavailableSource.cycle('news', { mode: 'throw' })
    ).at(-1)
    assert.equal(absent.status, 'unavailable')
    assert.equal(absent.successfulQueries, 0)
    assert.equal(absent.refreshing, false)
    assert.deepEqual(absent.items, [])
    assert.equal(absent.updatedAt, null)
  } finally {
    await empty.dispose()
    await failed.dispose()
    await unavailableSource.dispose()
  }
})

test('일부 키워드 오류는 성공한 검색을 보존하고 전체 성공으로 표시하지 않는다', async () => {
  const f = await fixture()
  try {
    const data = (await f.cycle('news', { mode: 'one-error' })).at(-1)
    assert.equal(data.status, 'partial')
    assert.equal(data.successfulQueries, 8)
    assert.equal(data.refreshing, false)
    assert.equal((await f.calls()).length, 9)
    assert.ok(data.items.length > 0)
  } finally {
    await f.dispose()
  }
})

test('진행 중인 검색 잠금을 존중하고 만료 후 한 번만 다음 검색을 실행한다', async () => {
  const f = await fixture()
  try {
    await f.db
      .prepare(
        `INSERT INTO media_refresh(kind,next_keyword,success_count,cycle_active,last_checked_at,last_success_at,lock_until)
      VALUES(?,0,0,1,NULL,NULL,?)`,
      )
      .bind('news', now + 45000)
      .run()
    const locked = await f.request()
    assert.equal(locked.status, 200)
    const data = await locked.json()
    assert.equal(data.refreshing, true)
    assert.equal(data.successfulQueries, 0)
    assert.equal((await f.calls()).length, 0)
    const released = await f.request('news', { clock: now + 45001 })
    assert.equal(released.status, 200)
    assert.equal((await released.json()).successfulQueries, 1)
    assert.equal((await f.calls()).length, 1)
  } finally {
    await f.dispose()
  }
})

test('잘못된 종류·DB 미설정·쓰기 요청은 검색이나 저장 변경 없이 거절한다', async () => {
  const f = await fixture()
  const missing = await fixture({ withDatabase: false })
  try {
    assert.equal((await f.request('other')).status, 400)
    assert.equal((await f.request('news', { method: 'POST' })).status, 405)
    assert.equal((await missing.request()).status, 503)
    assert.equal((await f.calls()).length, 0)
    const count = await f.db
      .prepare('SELECT COUNT(*) AS count FROM media_items')
      .first()
    assert.equal(count.count, 0)
  } finally {
    await f.dispose()
    await missing.dispose()
  }
})
