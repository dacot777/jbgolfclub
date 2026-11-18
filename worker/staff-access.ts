import { equal, hash, randomSecret } from './crypto'
import {
  PrivateRequestError,
  body,
  cookie,
  json,
  readCookie,
  sameOrigin,
} from './private-request'
import type { Env } from './types'

const STAFF_COOKIE = '__Host-jbgolf_staff'
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const DAY = 86_400_000
const TTL = 90 * DAY
type StaffRow = { session_hash: string; csrf_token: string; expires_at: number }

export async function staffSession(request: Request, env: Env) {
  const token = readCookie(request, STAFF_COOKIE)
  if (!TOKEN.test(token)) return null
  return env.DB.prepare(
    'SELECT session_hash,csrf_token,expires_at FROM staff_sessions WHERE session_hash=? AND expires_at>?',
  )
    .bind(await hash('staff:' + token), Date.now())
    .first<StaffRow>()
}

export async function requireStaff(request: Request, env: Env) {
  const session = await staffSession(request, env)
  if (!session) throw new PrivateRequestError('staff_access_required', 401)
  return session
}

export async function requireStaffMutation(request: Request, env: Env) {
  sameOrigin(request, env)
  const session = await requireStaff(request, env)
  if (!equal(request.headers.get('X-CSRF-Token') ?? '', session.csrf_token))
    throw new PrivateRequestError('invalid_csrf', 403)
  return session
}

export async function staffAccess(request: Request, env: Env) {
  const path = new URL(request.url).pathname
  if (path === '/api/staff/activate' && request.method === 'POST') {
    sameOrigin(request, env)
    const { token } = await body(request)
    if (typeof token !== 'string' || !TOKEN.test(token))
      throw new PrivateRequestError('invalid_grant', 401)
    const grantHash = await hash(token)
    const secret = randomSecret()
    const csrfToken = randomSecret()
    const now = Date.now()
    // D1 batches are transactions. Only the first redemption can create a session.
    const [created] = await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO staff_sessions(session_hash,csrf_token,expires_at) SELECT ?,?,? FROM staff_activation_grants WHERE token_hash=? AND expires_at>?',
      ).bind(
        await hash('staff:' + secret),
        csrfToken,
        now + TTL,
        grantHash,
        now,
      ),
      env.DB.prepare(
        'DELETE FROM staff_activation_grants WHERE token_hash=?',
      ).bind(grantHash),
    ])
    if (created.meta.changes !== 1)
      throw new PrivateRequestError('invalid_grant', 401)
    return json(
      { authenticated: true, csrfToken },
      200,
      cookie(STAFF_COOKIE, secret, TTL / 1000, false),
    )
  }
  if (path === '/api/staff/session' && request.method === 'GET') {
    const session = await staffSession(request, env)
    if (!session) return json({ authenticated: false })
    let refreshedCookie: string | undefined
    const now = Date.now()
    if (session.expires_at - now < 30 * DAY) {
      const updated = await env.DB.prepare(
        'UPDATE staff_sessions SET expires_at=? WHERE session_hash=? AND expires_at>?',
      )
        .bind(now + TTL, session.session_hash, now)
        .run()
      if (updated.meta.changes !== 1) return json({ authenticated: false })
      refreshedCookie = cookie(
        STAFF_COOKIE,
        readCookie(request, STAFF_COOKIE),
        TTL / 1000,
        false,
      )
    }
    return json(
      { authenticated: true, csrfToken: session.csrf_token },
      200,
      refreshedCookie,
    )
  }
  if (path === '/api/staff/logout' && request.method === 'POST') {
    const session = await requireStaffMutation(request, env)
    await env.DB.prepare('DELETE FROM staff_sessions WHERE session_hash=?')
      .bind(session.session_hash)
      .run()
    return json(
      { authenticated: false },
      200,
      cookie(STAFF_COOKIE, '', 0, false),
    )
  }
  return json({ error: { code: 'not_found' } }, 404)
}

export async function cleanupStaffAccess(env: Env) {
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM staff_activation_grants WHERE expires_at<=?',
    ).bind(now),
    env.DB.prepare('DELETE FROM staff_sessions WHERE expires_at<=?').bind(now),
  ])
}
