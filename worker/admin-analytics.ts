import type { Env } from './types'
import { readMetaAds } from './meta-ads'
import {
  createInquiry,
  deleteInquiry,
  listInquiries,
  updateInquiry,
  InquiryError,
} from './inquiries'
import { base64Url, equal, hash, randomSecret } from './crypto'
import {
  ANALYTICS_MENUS,
  type AnalyticsEvent,
  type AnalyticsMenu,
  type AnalyticsReport,
  type AnalyticsView,
  type AnalyticsVisit,
} from '../src/lib/analytics-types'

const ADMIN_COOKIE = '__Host-jbgolf_admin'
const VISITOR_COOKIE = '__Host-jbgolf_visitor'
const DAY = 86_400_000
const ADMIN_TTL = 8 * 3_600_000
const RATE_WINDOW = 15 * 60_000
const BODY_LIMIT = 2048
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN = /^[A-Za-z0-9_-]{43}$/
type AdminRow = { session_hash: string; csrf_token: string; expires_at: number }
type VisitRow = {
  id: string
  visitor_id: string
  started_at: number
  last_seen_at: number
  browser: string
  device: string
}
type ViewRow = {
  id: string
  visit_id: string
  menu: AnalyticsMenu
  entered_at: number
  last_seen_at: number
  ended_at: number | null
  active_ms: number
  last_seq: number
  is_active: number
}
class AnalyticsError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}
const encoder = new TextEncoder()
const timestamp = (value: number) => new Date(value).toISOString()

function configured(env: Env) {
  return (
    !!env.DB &&
    typeof env.ADMIN_ANALYTICS_KEY === 'string' &&
    env.ADMIN_ANALYTICS_KEY.length >= 32 &&
    /^v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(env.ADMIN_PASSWORD_VERIFIER ?? '')
  )
}
function json(value: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  if (cookie) headers.set('Set-Cookie', cookie)
  return new Response(JSON.stringify(value), { status, headers })
}
function empty(cookie?: string) {
  const headers = new Headers({ 'Cache-Control': 'no-store, private' })
  if (cookie) headers.set('Set-Cookie', cookie)
  return new Response(null, { status: 204, headers })
}
function cookie(name: string, value: string, seconds: number, strict = true) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=${strict ? 'Strict' : 'Lax'}; Path=/; Max-Age=${seconds}`
}
function readCookie(request: Request, name: string) {
  return (
    (request.headers.get('Cookie') ?? '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  )
}
function sameOrigin(request: Request, env: Env) {
  if (
    new URL(request.url).origin !== env.APP_ORIGIN ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new AnalyticsError('origin_not_allowed', 403)
}
async function body(
  request: Request,
  maxBytes = BODY_LIMIT,
): Promise<Record<string, unknown>> {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new AnalyticsError('invalid_request', 400)
  if (
    Number(request.headers.get('Content-Length') ?? 0) > maxBytes ||
    !request.body
  )
    throw new AnalyticsError('invalid_request', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    length += part.value.length
    if (length > maxBytes) {
      await reader.cancel()
      throw new AnalyticsError('invalid_request', 400)
    }
    chunks.push(part.value)
  }
  const combined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(combined))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error()
    return parsed
  } catch {
    throw new AnalyticsError('invalid_request', 400)
  }
}
async function hexHash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
async function hmac(env: Env, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.ADMIN_ANALYTICS_KEY!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
    ),
  )
}
async function adminSession(
  request: Request,
  env: Env,
): Promise<AdminRow | null> {
  const token = readCookie(request, ADMIN_COOKIE)
  if (!TOKEN.test(token)) return null
  return env.DB.prepare(
    'SELECT session_hash,csrf_token,expires_at FROM admin_sessions WHERE session_hash=? AND expires_at>?',
  )
    .bind(await hash('admin:' + token), Date.now())
    .first<AdminRow>()
}
async function requireAdmin(request: Request, env: Env) {
  const session = await adminSession(request, env)
  if (!session) throw new AnalyticsError('authentication_required', 401)
  return session
}
async function requireAdminMutation(request: Request, env: Env) {
  sameOrigin(request, env)
  const session = await requireAdmin(request, env)
  if (!equal(request.headers.get('X-CSRF-Token') ?? '', session.csrf_token))
    throw new AnalyticsError('invalid_csrf', 403)
  return session
}
async function visitor(
  request: Request,
  env: Env,
): Promise<{ id: string; setCookie?: string }> {
  const supplied = readCookie(request, VISITOR_COOKIE).split('.')
  if (
    supplied.length === 2 &&
    TOKEN.test(supplied[0]) &&
    TOKEN.test(supplied[1]) &&
    equal(await hmac(env, 'visitor:' + supplied[0]), supplied[1])
  )
    return { id: await hash('visitor:' + supplied[0]) }
  const token = randomSecret()
  return {
    id: await hash('visitor:' + token),
    setCookie: cookie(
      VISITOR_COOKIE,
      token + '.' + (await hmac(env, 'visitor:' + token)),
      30 * 86400,
      false,
    ),
  }
}
async function limit(env: Env, key: string, window: number, maximum: number) {
  const now = Date.now()
  const result = await env.DB.prepare(
    'INSERT INTO analytics_rate_limits(rate_key,window_started,attempts) VALUES(?,?,1) ON CONFLICT(rate_key) DO UPDATE SET attempts=CASE WHEN window_started<=? THEN 1 ELSE attempts+1 END,window_started=CASE WHEN window_started<=? THEN excluded.window_started ELSE window_started END RETURNING attempts',
  )
    .bind(key, now, now - window, now - window)
    .first<{ attempts: number }>()
  if (!result || result.attempts > maximum)
    throw new AnalyticsError('too_many_attempts', 429)
}
async function requestKey(request: Request, env: Env, scope: string) {
  // The raw network address is not stored or returned.
  return (
    scope +
    ':' +
    (await hmac(
      env,
      'rate:' + (request.headers.get('CF-Connecting-IP') ?? 'unknown'),
    ))
  )
}
function coarseAgent(request: Request) {
  const ua = request.headers.get('User-Agent') ?? ''
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '기타 브라우저'
  const device = /iPad|Tablet/i.test(ua)
    ? '태블릿'
    : /Mobile|Android|iPhone/i.test(ua)
      ? '모바일'
      : '데스크톱'
  return { browser, device }
}
async function login(request: Request, env: Env) {
  sameOrigin(request, env)
  const input = await body(request)
  if (
    typeof input.password !== 'string' ||
    !input.password ||
    input.password.length > 128
  )
    throw new AnalyticsError('invalid_request', 400)
  const ipKey = await requestKey(request, env, 'login')
  await limit(env, 'login:global', RATE_WINDOW, 100)
  await limit(env, ipKey, RATE_WINDOW, 5)
  const [, salt, expected] = env.ADMIN_PASSWORD_VERIFIER!.split('$')
  if (!equal(await hexHash(`${salt}:${input.password}`), expected))
    throw new AnalyticsError('invalid_credentials', 401)
  const token = randomSecret()
  const csrfToken = randomSecret()
  const now = Date.now()
  const existing = await adminSession(request, env)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare(
      'DELETE FROM analytics_rate_limits WHERE window_started<? OR rate_key=?',
    ).bind(now - DAY, ipKey),
    ...(existing
      ? [
          env.DB.prepare(
            'DELETE FROM admin_sessions WHERE session_hash=?',
          ).bind(existing.session_hash),
        ]
      : []),
    env.DB.prepare(
      'INSERT INTO admin_sessions(session_hash,csrf_token,expires_at) VALUES(?,?,?)',
    ).bind(await hash('admin:' + token), csrfToken, now + ADMIN_TTL),
  ])
  const identity = await visitor(request, env)
  await env.DB.prepare(
    'INSERT INTO analytics_visitors(id,first_seen_at,last_seen_at,is_owner) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE SET is_owner=1,last_seen_at=excluded.last_seen_at',
  )
    .bind(identity.id, now, now)
    .run()
  const response = json(
    { authenticated: true, configured: true, csrfToken },
    200,
    cookie(ADMIN_COOKIE, token, ADMIN_TTL / 1000),
  )
  if (identity.setCookie)
    response.headers.append('Set-Cookie', identity.setCookie)
  return response
}
function eventInput(input: Record<string, unknown>): AnalyticsEvent {
  if (
    typeof input.visitId !== 'string' ||
    !UUID.test(input.visitId) ||
    typeof input.viewId !== 'string' ||
    !UUID.test(input.viewId) ||
    !ANALYTICS_MENUS.includes(input.menu as AnalyticsMenu) ||
    !['enter', 'heartbeat', 'pause', 'resume', 'leave'].includes(
      String(input.phase),
    ) ||
    !Number.isSafeInteger(input.seq) ||
    Number(input.seq) < 0 ||
    Number(input.seq) > 10_000_000 ||
    !Number.isSafeInteger(input.activeMs) ||
    Number(input.activeMs) < 0 ||
    Number(input.activeMs) > 30 * DAY
  )
    throw new AnalyticsError('invalid_event', 400)
  return input as unknown as AnalyticsEvent
}
async function collect(request: Request, env: Env) {
  sameOrigin(request, env)
  if (
    request.headers.get('Sec-GPC') === '1' ||
    request.headers.get('DNT') === '1'
  )
    return empty()
  const event = eventInput(await body(request))
  if (await adminSession(request, env)) return empty()
  const identity = await visitor(request, env)
  const owner = await env.DB.prepare(
    'SELECT is_owner FROM analytics_visitors WHERE id=?',
  )
    .bind(identity.id)
    .first<{ is_owner: number }>()
  if (owner?.is_owner) return empty()
  await limit(env, await requestKey(request, env, 'events'), 60_000, 180)
  const now = Date.now()
  const visit = await env.DB.prepare(
    'SELECT * FROM analytics_visits WHERE id=?',
  )
    .bind(event.visitId)
    .first<VisitRow>()
  if (visit && visit.visitor_id !== identity.id)
    throw new AnalyticsError('invalid_event_owner', 409)
  const view = await env.DB.prepare('SELECT * FROM analytics_views WHERE id=?')
    .bind(event.viewId)
    .first<ViewRow>()
  if (view && (view.visit_id !== event.visitId || view.menu !== event.menu))
    throw new AnalyticsError('invalid_event_owner', 409)
  if (view && (event.seq <= view.last_seq || event.activeMs < view.active_ms))
    return empty(identity.setCookie)
  if (event.activeMs > now - (view?.entered_at ?? now) + 5000)
    throw new AnalyticsError('invalid_duration', 400)
  const active =
    event.phase === 'enter' ||
    event.phase === 'heartbeat' ||
    event.phase === 'resume'
  const ended = event.phase === 'leave' ? now : null
  const agent = coarseAgent(request)
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO analytics_visitors(id,first_seen_at,last_seen_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at',
    ).bind(identity.id, now, now),
    env.DB.prepare(
      'INSERT INTO analytics_visits(id,visitor_id,started_at,last_seen_at,browser,device) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at WHERE visitor_id=excluded.visitor_id',
    ).bind(event.visitId, identity.id, now, now, agent.browser, agent.device),
    env.DB.prepare(
      'INSERT INTO analytics_views(id,visit_id,menu,entered_at,last_seen_at,ended_at,active_ms,last_seq,is_active) SELECT ?,?,?,?,?,?,?,?,? FROM analytics_visits WHERE id=? AND visitor_id=? ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,ended_at=excluded.ended_at,active_ms=excluded.active_ms,last_seq=excluded.last_seq,is_active=excluded.is_active WHERE visit_id=excluded.visit_id AND menu=excluded.menu AND excluded.last_seq>last_seq AND excluded.active_ms>=active_ms AND EXISTS(SELECT 1 FROM analytics_visits v WHERE v.id=excluded.visit_id AND v.visitor_id=?)',
    ).bind(
      event.viewId,
      event.visitId,
      event.menu,
      now,
      now,
      ended,
      event.activeMs,
      event.seq,
      active ? 1 : 0,
      event.visitId,
      identity.id,
      identity.id,
    ),
  ])
  if (!visit) await cleanupAnalytics(env)
  return empty(identity.setCookie)
}
function cutoff(days: number, now: number) {
  const kst = new Date(now + 9 * 3_600_000)
  return (
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) -
    9 * 3_600_000 -
    (days - 1) * DAY
  )
}
async function analytics(request: Request, env: Env) {
  await requireAdmin(request, env)
  await cleanupAnalytics(env)
  const url = new URL(request.url)
  const days = Number(url.searchParams.get('days') ?? '1')
  const page = Number(url.searchParams.get('page') ?? '1')
  if (
    ![1, 7, 30].includes(days) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000
  )
    throw new AnalyticsError('invalid_range', 400)
  const now = Date.now()
  const from = cutoff(days, now)
  const pageSize = 50
  const summary = await env.DB.prepare(
    'SELECT COUNT(*) AS totalVisits,COUNT(DISTINCT v.visitor_id) AS totalVisitors,COALESCE(SUM((SELECT COALESCE(SUM(w.active_ms),0) FROM analytics_views w WHERE w.visit_id=v.id)),0) AS totalActiveMs FROM analytics_visits v JOIN analytics_visitors p ON p.id=v.visitor_id WHERE p.is_owner=0 AND v.started_at>=?',
  )
    .bind(from)
    .first<{
      totalVisits: number
      totalVisitors: number
      totalActiveMs: number
    }>()
  const selected = await env.DB.prepare(
    'SELECT v.* FROM analytics_visits v JOIN analytics_visitors p ON p.id=v.visitor_id WHERE p.is_owner=0 AND v.started_at>=? ORDER BY v.last_seen_at DESC,v.id LIMIT ? OFFSET ?',
  )
    .bind(from, pageSize, (page - 1) * pageSize)
    .all<VisitRow>()
  let viewRows: ViewRow[] = []
  if (selected.results.length)
    viewRows = (
      await env.DB.prepare(
        `SELECT * FROM analytics_views WHERE visit_id IN (${selected.results.map(() => '?').join(',')}) ORDER BY entered_at,id`,
      )
        .bind(...selected.results.map((v) => v.id))
        .all<ViewRow>()
    ).results
  const visits: AnalyticsVisit[] = selected.results.map((visit) => {
    const rows = viewRows.filter((row) => row.visit_id === visit.id)
    const views: AnalyticsView[] = rows.map((row) => ({
      id: row.id,
      menu: row.menu,
      enteredAt: timestamp(row.entered_at),
      lastSeenAt: timestamp(row.last_seen_at),
      endedAt: row.ended_at === null ? null : timestamp(row.ended_at),
      activeMs: row.active_ms,
      active: !!row.is_active && now - row.last_seen_at < 75_000,
    }))
    const live = views.some((view) => view.active)
    const last = rows.reduce<ViewRow | null>(
      (latest, row) =>
        !latest || row.entered_at > latest.entered_at ? row : latest,
      null,
    )
    const endedAt =
      !rows.some((row) => row.is_active) && last?.ended_at
        ? timestamp(last.ended_at)
        : null
    return {
      id: visit.id,
      visitorLabel: `방문자 ${visit.visitor_id.slice(0, 8).toUpperCase()}`,
      startedAt: timestamp(visit.started_at),
      lastSeenAt: timestamp(visit.last_seen_at),
      endedAt,
      activeMs: rows.reduce((sum, row) => sum + row.active_ms, 0),
      browser: visit.browser,
      device: visit.device,
      status: live ? 'active' : endedAt ? 'ended' : 'idle',
      views,
    }
  })
  return json({
    days: days as 1 | 7 | 30,
    page,
    pageSize,
    totalVisits: summary?.totalVisits ?? 0,
    totalVisitors: summary?.totalVisitors ?? 0,
    totalActiveMs: summary?.totalActiveMs ?? 0,
    totalPages: Math.ceil((summary?.totalVisits ?? 0) / pageSize),
    visits,
    updatedAt: timestamp(now),
  } satisfies AnalyticsReport)
}

/** Daily maintenance is independent of Instagram token configuration. */
export async function cleanupAnalytics(env: Env): Promise<void> {
  if (!configured(env)) return
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM analytics_visits WHERE id IN (SELECT id FROM analytics_visits WHERE started_at<? ORDER BY started_at LIMIT 500)',
    ).bind(now - 30 * DAY),
    env.DB.prepare(
      'DELETE FROM analytics_visitors WHERE id IN (SELECT id FROM analytics_visitors WHERE last_seen_at<? AND NOT EXISTS(SELECT 1 FROM analytics_visits v WHERE v.visitor_id=analytics_visitors.id) LIMIT 500)',
    ).bind(now - 30 * DAY),
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare(
      'DELETE FROM analytics_rate_limits WHERE window_started<?',
    ).bind(now - DAY),
  ])
}

/** Admin credentials and individual visitor history never enter public responses. */
export async function adminAnalytics(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname
    if (path === '/api/admin/session' && request.method === 'GET') {
      if (!configured(env))
        return json({ authenticated: false, configured: false })
      const session = await adminSession(request, env)
      return json(
        session
          ? {
              authenticated: true,
              configured: true,
              csrfToken: session.csrf_token,
            }
          : { authenticated: false, configured: true },
      )
    }
    if (!configured(env)) throw new AnalyticsError('admin_not_configured', 503)
    if (path === '/api/admin/login' && request.method === 'POST')
      return await login(request, env)
    if (path === '/api/admin/logout' && request.method === 'POST') {
      const session = await requireAdminMutation(request, env)
      await env.DB.prepare('DELETE FROM admin_sessions WHERE session_hash=?')
        .bind(session.session_hash)
        .run()
      return json({ authenticated: false }, 200, cookie(ADMIN_COOKIE, '', 0))
    }
    if (path === '/api/admin/inquiries' && request.method === 'GET') {
      await requireAdmin(request, env)
      return json({ items: await listInquiries(env) })
    }
    if (path === '/api/admin/inquiries' && request.method === 'POST') {
      await requireAdminMutation(request, env)
      return json({
        item: await createInquiry(env, await body(request, 16_384), (value) =>
          hmac(env, value),
        ),
      })
    }
    const inquiryPath = /^\/api\/admin\/inquiries\/([^/]+)$/.exec(path)
    if (inquiryPath && request.method === 'DELETE') {
      await requireAdminMutation(request, env)
      return json(await deleteInquiry(env, inquiryPath[1], await body(request)))
    }
    if (inquiryPath && request.method === 'PUT') {
      await requireAdminMutation(request, env)
      return json({
        item: await updateInquiry(
          env,
          inquiryPath[1],
          await body(request, 16_384),
        ),
      })
    }
    if (path === '/api/admin/meta-ads' && request.method === 'GET') {
      await requireAdmin(request, env)
      return json(await readMetaAds(env))
    }
    if (path === '/api/admin/analytics' && request.method === 'GET')
      return await analytics(request, env)
    if (path === '/api/analytics/event' && request.method === 'POST')
      return await collect(request, env)
    return json({ error: { code: 'not_found' } }, 404)
  } catch (error) {
    const knownError =
      error instanceof AnalyticsError || error instanceof InquiryError
    const fallback = new URL(request.url).pathname.startsWith(
      '/api/admin/inquiries',
    )
      ? 'inquiries_unavailable'
      : 'analytics_unavailable'
    const response = json(
      { error: { code: knownError ? error.code : fallback } },
      knownError ? error.status : 503,
    )
    if (response.status === 429) response.headers.set('Retry-After', '900')
    return response
  }
}
