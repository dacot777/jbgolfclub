import type { Env } from './types'
import { ConnectionError } from './types'
import type { CalendarAccount, CalendarKind } from '../src/lib/calendar-types'
import { isCalendarAccount } from '../src/lib/calendar-types'
import { decryptToken, encryptToken } from './crypto'
import { refreshToken } from './instagram'
import { parseInstagramJson } from './json'

const DAY = 86400000
const FIELDS =
  'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
const THUMBNAIL_FIELDS = 'id,media_type,media_url,thumbnail_url'

export function calendarTokenContext(account: string, userId: string) {
  return 'jbgolf:calendar:v1:' + account + ':' + userId
}

type Grant = {
  account: CalendarAccount
  user_id: string
  encrypted_token: string
  token_expires_at: number
  refreshed_at: number
  after_cursor: string | null
  scan_started_at: number
  completed_at: number | null
}
type Media = {
  id?: string
  permalink?: string
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  timestamp?: string
  caption?: string
}
type Item = {
  id: string
  kind: CalendarKind
  title: string
  date: string
  time: string
  permalink: string
  thumbnail: string | null
  useAlbumChild: number
}

async function graph<T>(
  env: Env,
  endpoint: string,
  fields: string,
  token: string,
  after?: string,
) {
  const url = new URL(
    'https://graph.instagram.com/' + env.INSTAGRAM_API_VERSION + '/' + endpoint,
  )
  url.searchParams.set('fields', fields)
  if (endpoint.endsWith('/media')) url.searchParams.set('limit', '25')
  if (endpoint.endsWith('/children')) url.searchParams.set('limit', '1')
  if (after) url.searchParams.set('after', after)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    })
  } catch {
    throw new ConnectionError('instagram_unreachable', 502)
  }
  let result: unknown
  try {
    result = parseInstagramJson(await res.text())
  } catch {
    throw new ConnectionError('instagram_invalid_response', 502)
  }
  const error = (result as { error?: { code?: number } } | null)?.error
  if (!res.ok || error) {
    if (res.status === 401 || error?.code === 190)
      throw new ConnectionError('token_expired', 401)
    if (after && error?.code === 100)
      throw new ConnectionError('invalid_cursor', 502)
    throw new ConnectionError('instagram_unavailable', 502)
  }
  return result as T
}

function thumbnail(media: Media) {
  const raw =
    media.media_type === 'VIDEO' ? media.thumbnail_url : media.media_url
  if (typeof raw !== 'string' || raw.length > 8192) return null
  try {
    const url = new URL(raw)
    if (
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      /(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(url.hostname) &&
      !url.searchParams.has('access_token')
    )
      return url.href
  } catch {
    /* Unavailable remote media keeps its caption and link. */
  }
  return null
}

function item(media: Media): Item | null {
  if (
    !media ||
    !/^\d{1,32}$/.test(String(media.id ?? '')) ||
    !media.timestamp ||
    !media.permalink
  ) {
    throw new ConnectionError('instagram_invalid_response', 502)
  }
  let url: URL
  try {
    url = new URL(media.permalink)
  } catch {
    throw new ConnectionError('instagram_invalid_response', 502)
  }
  if (
    !['www.instagram.com', 'instagram.com'].includes(url.hostname) ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port
  )
    throw new ConnectionError('instagram_invalid_response', 502)
  const path = url.pathname.match(
    /^\/(?:[a-z0-9._]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?$/i,
  )
  if (!path) return null
  const timestamp = Date.parse(media.timestamp)
  if (!Number.isFinite(timestamp))
    throw new ConnectionError('instagram_invalid_response', 502)
  const kst = new Date(timestamp + 9 * 3600000).toISOString()
  const kind = path[1].toLowerCase().startsWith('reel') ? 'reel' : 'post'
  const cover = thumbnail(media)
  return {
    id: String(media.id),
    kind,
    title: media.caption?.trim() || (kind === 'reel' ? '릴스' : '게시물'),
    date: kst.slice(0, 10),
    time: kst.slice(11, 16),
    permalink: 'https://www.instagram.com/' + path[1] + '/' + path[2] + '/',
    thumbnail: cover,
    useAlbumChild: media.media_type === 'CAROUSEL_ALBUM' && !cover ? 1 : 0,
  }
}

async function page(env: Env, grant: Grant, token: string, after?: string) {
  const data = await graph<{
    data: Media[]
    paging?: { next?: string; cursors?: { after?: string } }
  }>(env, grant.user_id + '/media', FIELDS, token, after)
  if (!Array.isArray(data?.data))
    throw new ConnectionError('instagram_invalid_response', 502)
  const cursor = data.paging?.next ? data.paging.cursors?.after : null
  if (
    data.paging?.next &&
    (typeof cursor !== 'string' ||
      !cursor ||
      cursor === after ||
      cursor.length > 4096)
  ) {
    throw new ConnectionError('instagram_invalid_response', 502)
  }
  return {
    items: data.data.map(item).filter((value): value is Item => Boolean(value)),
    cursor: cursor || null,
  }
}

const VALID_LEASE =
  'EXISTS(SELECT 1 FROM calendar_instagram_accounts WHERE account=? AND lease=?)'

function saveMedia(
  env: Env,
  account: string,
  lease: string,
  items: Item[],
  now: number,
) {
  return env.DB.prepare(
    `INSERT INTO calendar_instagram_media
    (id,account,kind,title,date,time,permalink,thumbnail_url,use_album_child,thumbnail_checked_at,seen_at)
    SELECT value->>'$.id', ?, value->>'$.kind', value->>'$.title', value->>'$.date', value->>'$.time',
      value->>'$.permalink', value->>'$.thumbnail', value->>'$.useAlbumChild',
      CASE WHEN value->>'$.useAlbumChild' THEN 0 ELSE ? END, ? FROM json_each(?) WHERE ${VALID_LEASE}
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,date=excluded.date,time=excluded.time,
      permalink=excluded.permalink,use_album_child=excluded.use_album_child,
      thumbnail_url=CASE WHEN excluded.use_album_child AND calendar_instagram_media.use_album_child THEN calendar_instagram_media.thumbnail_url ELSE excluded.thumbnail_url END,
      thumbnail_checked_at=CASE WHEN excluded.use_album_child AND calendar_instagram_media.use_album_child THEN calendar_instagram_media.thumbnail_checked_at ELSE excluded.thumbnail_checked_at END,
      seen_at=excluded.seen_at
    WHERE calendar_instagram_media.account=excluded.account`,
  ).bind(account, now, now, JSON.stringify(items), account, lease)
}

export async function syncCalendarAccount(env: Env, account: CalendarAccount) {
  const now = Date.now()
  const lease = crypto.randomUUID()
  const grant = await env.DB.prepare(
    `UPDATE calendar_instagram_accounts SET lease=?,lease_until=?
    WHERE account=? AND lease_until<=? RETURNING *`,
  )
    .bind(lease, now + 180000, account, now)
    .first<Grant>()
  if (!grant) return
  try {
    if (grant.token_expires_at <= now)
      throw new ConnectionError('token_expired')
    const context = calendarTokenContext(account, grant.user_id)
    let token = await decryptToken(
      grant.encrypted_token,
      env.TOKEN_ENCRYPTION_KEY,
      context,
    )
    if (
      grant.token_expires_at <= now + 14 * DAY &&
      now - grant.refreshed_at >= DAY
    ) {
      const fresh = await refreshToken(token)
      token = fresh.access_token
      const encrypted = await encryptToken(
        token,
        env.TOKEN_ENCRYPTION_KEY,
        context,
      )
      const saved = await env.DB.prepare(
        `UPDATE calendar_instagram_accounts SET encrypted_token=?,refreshed_at=?,token_expires_at=?
        WHERE account=? AND lease=?`,
      )
        .bind(encrypted, now, now + fresh.expires_in! * 1000, account, lease)
        .run()
      if (!saved.meta.changes) return
    }

    // Keep the newest page fresh even while the bounded history scan is advancing.
    const head = await page(env, grant, token)
    let cursor = grant.after_cursor
    let complete = grant.completed_at
    let scan = grant.scan_started_at
    const batch = [saveMedia(env, account, lease, head.items, now)]
    if (cursor) {
      const older = await page(env, grant, token, cursor)
      batch.push(saveMedia(env, account, lease, older.items, now))
      cursor = older.cursor
    } else if (!complete || now - complete >= 7 * DAY) {
      scan = now
      cursor = head.cursor
    } else {
      // A previously complete account only needs the head unless the newest page
      // is entirely unknown (a burst can span multiple pages between hourly runs).
      if (head.cursor && head.items.length) {
        const oldest = head.items[head.items.length - 1]
        const known = await env.DB.prepare(
          'SELECT id FROM calendar_instagram_media WHERE id=? AND account=?',
        )
          .bind(oldest.id, account)
          .first()
        if (!known) {
          scan = now
          cursor = head.cursor
        }
      }
    }
    if (!cursor && (grant.after_cursor || !complete || scan === now)) {
      complete = now
      // Reconcile only on a complete traversal. A page error never clears history.
      batch.push(
        env.DB.prepare(
          `DELETE FROM calendar_instagram_media WHERE account=? AND seen_at<? AND ${VALID_LEASE}`,
        ).bind(account, scan, account, lease),
      )
    }
    batch.push(
      env.DB.prepare(
        `UPDATE calendar_instagram_accounts SET after_cursor=?,scan_started_at=?,completed_at=?,
      sync_error=NULL,last_synced_at=?,lease=NULL,lease_until=0 WHERE account=? AND lease=?`,
      ).bind(cursor, scan, complete, now, account, lease),
    )
    await env.DB.batch(batch)
  } catch (error) {
    const code =
      error instanceof ConnectionError ? error.code : 'instagram_unavailable'
    await env.DB.prepare(
      `UPDATE calendar_instagram_accounts SET sync_error=?,lease=NULL,lease_until=0,
      after_cursor=CASE WHEN ?='invalid_cursor' THEN NULL ELSE after_cursor END,
      completed_at=CASE WHEN ?='invalid_cursor' THEN NULL ELSE completed_at END
      WHERE account=? AND lease=?`,
    )
      .bind(code, code, code, account, lease)
      .run()
  }
}

export async function syncCalendarInstagram(env: Env) {
  // A separate hourly invocation keeps the three profile reads outside the ads collector's budget.
  const [, grants] = await env.DB.batch<{ account: string }>([
    env.DB.prepare(
      'DELETE FROM calendar_instagram_states WHERE expires_at<=?',
    ).bind(Date.now()),
    env.DB.prepare('SELECT account FROM calendar_instagram_accounts'),
  ])
  await Promise.all(
    grants.results.map(
      ({ account }) =>
        isCalendarAccount(account) && syncCalendarAccount(env, account),
    ),
  )
}

export async function calendarInstagramThumbnail(
  env: Env,
  id: string,
): Promise<Response> {
  const missing = () =>
    new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'private,no-store' },
    })
  if (!/^\d{1,32}$/.test(id)) return missing()
  const row = await env.DB.prepare(
    `SELECT m.thumbnail_url,m.use_album_child,m.thumbnail_checked_at,a.account,a.user_id,a.encrypted_token,a.token_expires_at
    FROM calendar_instagram_media m JOIN calendar_instagram_accounts a ON a.account=m.account WHERE m.id=?`,
  )
    .bind(id)
    .first<
      Grant & {
        thumbnail_url: string | null
        use_album_child: number
        thumbnail_checked_at: number
      }
    >()
  if (!row) return missing()
  let url = row.thumbnail_url
  const hex = url && new URL(url).searchParams.get('oe')
  const soon =
    hex &&
    /^[a-f\d]{8}$/i.test(hex) &&
    parseInt(hex, 16) * 1000 < Date.now() + 300000
  const age = Date.now() - row.thumbnail_checked_at
  if (
    (age > DAY || (soon && age > 300000)) &&
    row.token_expires_at > Date.now()
  ) {
    // Retry at most once in five minutes per image, including after rate limits.
    const checkedAt = Date.now()
    const lock = await env.DB.prepare(
      'UPDATE calendar_instagram_media SET thumbnail_checked_at=? WHERE id=? AND thumbnail_checked_at=?',
    )
      .bind(checkedAt, id, row.thumbnail_checked_at)
      .run()
    if (lock.meta.changes) {
      try {
        const token = await decryptToken(
          row.encrypted_token,
          env.TOKEN_ENCRYPTION_KEY,
          calendarTokenContext(row.account, row.user_id),
        )
        const media = row.use_album_child
          ? (
              await graph<{ data: Media[] }>(
                env,
                id + '/children',
                THUMBNAIL_FIELDS,
                token,
              )
            ).data?.[0]
          : await graph<Media>(env, id, THUMBNAIL_FIELDS, token)
        if (media && (row.use_album_child || String(media.id) === id)) {
          url = thumbnail(media)
          await env.DB.prepare(
            'UPDATE calendar_instagram_media SET thumbnail_url=? WHERE id=? AND account=? AND thumbnail_checked_at=?',
          )
            .bind(url, id, row.account, checkedAt)
            .run()
        }
      } catch {
        /* Keep the last verified CDN image where still available. */
      }
    }
  }
  if (!url) return missing()
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'private,no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
