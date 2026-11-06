import type { D1Database } from '@cloudflare/workers-types'
import {
  COMPANY_MEDIA_KEYWORDS,
  type MediaCandidate,
  type MediaFeed,
  type MediaItem,
  type MediaKind,
} from '../src/lib/media-types'
import { searchNews } from './media-news'
import { searchBlogs } from './media-blog'

type RefreshRow = {
  kind: MediaKind
  next_keyword: number
  success_count: number
  cycle_active: number
  last_checked_at: number | null
  last_success_at: number | null
  lock_until: number
}
type Search = (kind: MediaKind, keyword: string) => Promise<MediaCandidate[]>
const INTERVAL = 30_000
const LOCK = 45_000
const LIMIT = 1000
const iso = (value: number | null) =>
  value === null ? null : new Date(value).toISOString()
const normalized = (value: string) =>
  value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
const plain = (value: unknown, limit: number) =>
  typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit)
    : ''
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/** Search-result URLs are untrusted. Never turn this into an arbitrary URL proxy. */
export function publicUrl(raw: unknown, image = false): string | null {
  if (typeof raw !== 'string' || raw.length > 3000) return null
  try {
    const url = new URL(raw)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port
    )
      return null
    const host = url.hostname.toLowerCase()
    if (
      !host.includes('.') ||
      host.includes(':') ||
      /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
      /(?:^|\.)(?:nip\.io|sslip\.io)$/.test(host)
    )
      return null
    if (image) {
      if (url.protocol !== 'https:') return null
      return url.href
    }
    url.hash = ''
    if (host === 'm.blog.naver.com') url.hostname = 'blog.naver.com'
    if (
      url.hostname === 'blog.naver.com' &&
      /PostView\.naver$/i.test(url.pathname)
    ) {
      const blog = url.searchParams.get('blogId')
      const post = url.searchParams.get('logNo')
      if (blog && /^[\w-]+$/.test(blog) && post && /^\d+$/.test(post))
        return `https://blog.naver.com/${blog}/${post}`
    }
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|fbclid$|gclid$|msockid$|ocid$|igsh$|tracking)/i.test(key))
        url.searchParams.delete(key)
    url.searchParams.sort()
    return url.href
  } catch {
    return null
  }
}

function relevant(candidate: MediaCandidate) {
  const text = normalized(
    `${candidate.title} ${candidate.searchText} ${candidate.url}`,
  )
  const golf = /골프|GOLF/.test(text)
  return COMPANY_MEDIA_KEYWORDS.filter((keyword) => {
    if (!text.includes(normalized(keyword))) return false
    return !['JB아카데미', 'JB ACADEMY'].includes(keyword) || golf
  })
}

async function identity(kind: MediaKind, url: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(url.replace(/^https?:/, '')),
  )
  return `${kind}:${Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`
}

async function saveItems(
  db: D1Database,
  kind: MediaKind,
  candidates: MediaCandidate[],
  now: number,
) {
  const received = new Map<string, MediaItem>()
  for (const candidate of candidates.slice(0, 30)) {
    const url = publicUrl(candidate.url)
    const title = plain(candidate.title, 400)
    if (!url || !title) continue
    const matchedKeywords = relevant(candidate)
    if (!matchedKeywords.length) continue
    const id = await identity(kind, url)
    const date =
      candidate.publishedAt &&
      Number.isFinite(Date.parse(candidate.publishedAt))
        ? new Date(candidate.publishedAt).toISOString()
        : null
    const previous = received.get(id)
    received.set(id, {
      id,
      title,
      url,
      publisher: plain(candidate.publisher, 120) || new URL(url).hostname,
      author: plain(candidate.author, 120) || null,
      thumbnailUrl: publicUrl(candidate.thumbnailUrl, true),
      publishedAt: date,
      firstSeenAt: new Date(now).toISOString(),
      matchedKeywords: [
        ...new Set([...(previous?.matchedKeywords ?? []), ...matchedKeywords]),
      ],
    })
  }
  if (!received.size) return
  const values = [...received.values()]
  const existing = await db
    .prepare(
      `SELECT id,data FROM media_items WHERE kind=? AND id IN (${values.map(() => '?').join(',')})`,
    )
    .bind(kind, ...values.map((item) => item.id))
    .all<{ id: string; data: string }>()
  for (const old of existing.results) {
    const record = JSON.parse(old.data) as MediaItem
    const item = received.get(old.id)!
    item.firstSeenAt = record.firstSeenAt
    item.thumbnailUrl ??= record.thumbnailUrl
    item.publishedAt ??= record.publishedAt
    item.author ??= record.author
    item.matchedKeywords = [
      ...new Set([...record.matchedKeywords, ...item.matchedKeywords]),
    ]
  }
  await db.batch(
    [...received.values()].map((item) =>
      db
        .prepare(
          'INSERT INTO media_items(id,kind,url,data,published_at,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,data=excluded.data,published_at=excluded.published_at,last_seen_at=excluded.last_seen_at',
        )
        .bind(
          item.id,
          kind,
          item.url,
          JSON.stringify(item),
          item.publishedAt,
          item.firstSeenAt,
          new Date(now).toISOString(),
        ),
    ),
  )
  await db
    .prepare(
      'DELETE FROM media_items WHERE kind=? AND id NOT IN (SELECT id FROM media_items WHERE kind=? ORDER BY COALESCE(published_at,first_seen_at) DESC LIMIT ?)',
    )
    .bind(kind, kind, LIMIT)
    .run()
}

async function responseFor(
  db: D1Database,
  row: RefreshRow,
  cached = false,
): Promise<Response> {
  const stored = await db
    .prepare(
      'SELECT data FROM media_items WHERE kind=? ORDER BY COALESCE(published_at,first_seen_at) DESC LIMIT ?',
    )
    .bind(row.kind, LIMIT)
    .all<{ data: string }>()
  const items = stored.results.map(
    (record) => JSON.parse(record.data) as MediaItem,
  )
  const status: MediaFeed['status'] =
    cached && items.length > 0
      ? 'cached'
      : row.success_count === COMPANY_MEDIA_KEYWORDS.length
        ? 'fresh'
        : row.success_count > 0
          ? 'partial'
          : items.length
            ? 'cached'
            : 'unavailable'
  return json({
    kind: row.kind,
    keywords: [...COMPANY_MEDIA_KEYWORDS],
    items,
    updatedAt: iso(row.last_success_at),
    checkedAt: iso(row.last_checked_at),
    status,
    refreshing: Boolean(row.cycle_active),
    successfulQueries: row.success_count,
    totalQueries: COMPANY_MEDIA_KEYWORDS.length,
  } satisfies MediaFeed)
}

const productionSearch: Search = (kind, keyword) =>
  kind === 'news' ? searchNews(keyword) : searchBlogs(keyword)

/** One keyword per request keeps public discovery inside Workers Free CPU limits. */
export async function mediaFeed(
  request: Request,
  db: D1Database | undefined,
  search: Search = productionSearch,
  now: () => number = Date.now,
): Promise<Response> {
  if (request.method !== 'GET')
    return json({ error: { code: 'method_not_allowed' } }, 405)
  const kind = new URL(request.url).searchParams.get('kind')
  if (kind !== 'news' && kind !== 'blog')
    return json({ error: { code: 'invalid_media_kind' } }, 400)
  if (!db) return json({ error: { code: 'media_unavailable' } }, 503)
  try {
    await db
      .prepare('INSERT OR IGNORE INTO media_refresh(kind) VALUES(?)')
      .bind(kind)
      .run()
    let state = (await db
      .prepare('SELECT * FROM media_refresh WHERE kind=?')
      .bind(kind)
      .first<RefreshRow>())!
    const started = now()
    if (
      !state.cycle_active &&
      state.last_checked_at !== null &&
      started - state.last_checked_at < INTERVAL
    )
      return responseFor(db, state, true)
    const claimed = await db
      .prepare(
        'UPDATE media_refresh SET next_keyword=CASE WHEN cycle_active=0 THEN 0 ELSE next_keyword END,success_count=CASE WHEN cycle_active=0 THEN 0 ELSE success_count END,cycle_active=1,lock_until=? WHERE kind=? AND lock_until<=? RETURNING *',
      )
      .bind(started + LOCK, kind, started)
      .first<RefreshRow>()
    if (!claimed) {
      state = (await db
        .prepare('SELECT * FROM media_refresh WHERE kind=?')
        .bind(kind)
        .first<RefreshRow>())!
      return responseFor(db, state)
    }
    let succeeded = false
    try {
      const keyword = COMPANY_MEDIA_KEYWORDS[claimed.next_keyword]
      if (!keyword) throw new Error('Invalid media step')
      const candidates = await search(kind, keyword)
      await saveItems(db, kind, candidates, now())
      succeeded = true
    } catch {
      /* Keep previously discovered public items when a source is unavailable. */
    }
    const finished = now()
    const next = claimed.next_keyword + 1
    await db
      .prepare(
        'UPDATE media_refresh SET next_keyword=?,success_count=?,cycle_active=?,last_checked_at=?,last_success_at=CASE WHEN ?=1 THEN ? ELSE last_success_at END,lock_until=0 WHERE kind=? AND lock_until=?',
      )
      .bind(
        next,
        claimed.success_count + (succeeded ? 1 : 0),
        next < COMPANY_MEDIA_KEYWORDS.length ? 1 : 0,
        finished,
        succeeded ? 1 : 0,
        finished,
        kind,
        claimed.lock_until,
      )
      .run()
    state = (await db
      .prepare('SELECT * FROM media_refresh WHERE kind=?')
      .bind(kind)
      .first<RefreshRow>())!
    return responseFor(db, state)
  } catch {
    return json({ error: { code: 'media_unavailable' } }, 503)
  }
}
