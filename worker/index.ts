import type { Env, ConnectionRow, SessionRow } from './types'
import { ConnectionError } from './types'
import { reviewedPerformance } from './reviewed-performance'
import { mediaFeed } from './media-feed'
import {
  authorizationUrl,
  configuration,
  exchangeCode,
  normalizeUsername,
  refreshToken,
} from './instagram'
import {
  decryptToken,
  encryptToken,
  equal,
  hash,
  randomSecret,
  signedRequest,
} from './crypto'

const STATE_COOKIE = '__Host-jbgolf_ig_state'
const SESSION_COOKIE = '__Host-jbgolf_session'
const DAY = 86400000

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`
}
function readCookie(request: Request, name: string) {
  return (
    (request.headers.get('Cookie') ?? '')
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  )
}
function redirect(url: string, cookies: string[] = []) {
  const headers = new Headers({ Location: url, 'Cache-Control': 'no-store' })
  cookies.forEach((c) => headers.append('Set-Cookie', c))
  return new Response(null, { status: 303, headers })
}
function sameOrigin(request: Request, env: Env) {
  if (
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    new URL(request.url).origin !== env.APP_ORIGIN
  )
    throw new ConnectionError('origin_not_allowed', 403)
}
async function session(request: Request, env: Env): Promise<SessionRow | null> {
  const secret = readCookie(request, SESSION_COOKIE)
  if (!secret) return null
  return env.DB.prepare(
    'SELECT user_id, csrf_token, expires_at FROM sessions WHERE session_hash = ? AND expires_at > ?',
  )
    .bind(await hash(secret), Date.now())
    .first<SessionRow>()
}
async function owner(request: Request, env: Env) {
  sameOrigin(request, env)
  const user = await session(request, env)
  if (
    !user ||
    !equal(request.headers.get('X-CSRF-Token') ?? '', user.csrf_token)
  )
    throw new ConnectionError('authentication_required', 401)
  const connection = await env.DB.prepare(
    'SELECT * FROM instagram_connection WHERE id = 1',
  ).first<ConnectionRow>()
  if (!connection || connection.user_id !== user.user_id)
    throw new ConnectionError('authentication_required', 401)
  return { user, connection }
}
async function status(request: Request, env: Env) {
  if (!configuration(env) || !env.DB)
    return json({
      configured: false,
      authenticated: false,
      connection: null,
      advertisingAccess: false,
    })
  const user = await session(request, env)
  if (!user)
    return json({
      configured: true,
      authenticated: false,
      targetUsername: normalizeUsername(env.INSTAGRAM_ACCOUNT_USERNAME),
      connection: null,
      advertisingAccess: false,
    })
  const row = await env.DB.prepare(
    'SELECT * FROM instagram_connection WHERE id = 1',
  ).first<ConnectionRow>()
  if (!row || row.user_id !== user.user_id)
    return json({
      configured: true,
      authenticated: false,
      connection: null,
      advertisingAccess: false,
    })
  return json({
    configured: true,
    authenticated: true,
    csrfToken: user.csrf_token,
    advertisingAccess: false,
    connection: {
      username: row.username,
      userId: row.user_id,
      connectedAt: row.connected_at,
      tokenExpiresAt: row.token_expires_at,
      needsReconnect:
        row.token_expires_at <= Date.now() ||
        row.refresh_error === 'instagram_authorization_failed',
      refreshWarning: Boolean(row.refresh_error),
    },
  })
}
async function start(request: Request, env: Env) {
  sameOrigin(request, env)
  if (!configuration(env))
    throw new ConnectionError('server_not_configured', 503)
  // Validate the encryption key before asking the user to authorize the app.
  await encryptToken('configuration-check', env.TOKEN_ENCRYPTION_KEY)
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ])
  const pending = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM oauth_states',
  ).first<{ total: number }>()
  if ((pending?.total ?? 0) >= 30)
    throw new ConnectionError('too_many_attempts', 429)
  const state = randomSecret()
  await env.DB.prepare(
    'INSERT INTO oauth_states(state_hash, expires_at) VALUES (?, ?)',
  )
    .bind(await hash(state), now + 600000)
    .run()
  return redirect(authorizationUrl(env, state), [
    cookie(STATE_COOKIE, state, 600),
  ])
}
async function callback(request: Request, env: Env) {
  if (!configuration(env))
    throw new ConnectionError('server_not_configured', 503)
  const url = new URL(request.url)
  const expiredCookie = cookie(STATE_COOKIE, '', 0)
  const finishError = (code: string) =>
    redirect(
      `${env.APP_ORIGIN}/?instagram_error=${encodeURIComponent(code)}#overview`,
      [expiredCookie],
    )
  const state = url.searchParams.get('state') ?? ''
  const stateCookie = readCookie(request, STATE_COOKIE)
  if (!state || !stateCookie || !equal(state, stateCookie))
    return finishError('invalid_state')
  const consumed = await env.DB.prepare(
    'DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING state_hash',
  )
    .bind(await hash(state), Date.now())
    .first()
  if (!consumed) return finishError('expired_state')
  if (url.searchParams.has('error'))
    return finishError('authorization_cancelled')
  const code = url.searchParams.get('code')
  if (!code || code.length > 4096) return finishError('authorization_failed')
  try {
    const result = await exchangeCode(env, code)
    const existing = await env.DB.prepare(
      'SELECT user_id FROM instagram_connection WHERE id = 1',
    ).first<{ user_id: string }>()
    if (existing && existing.user_id !== result.profile.user_id)
      throw new ConnectionError('different_instagram_account', 403)
    const now = Date.now()
    const sessionSecret = randomSecret()
    const csrf = randomSecret()
    const encrypted = await encryptToken(result.token, env.TOKEN_ENCRYPTION_KEY)
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO instagram_connection(id,user_id,oauth_user_id,app_scoped_id,username,encrypted_token,connected_at,token_expires_at,last_refreshed_at) VALUES (1,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET oauth_user_id=excluded.oauth_user_id,app_scoped_id=excluded.app_scoped_id,username=excluded.username,encrypted_token=excluded.encrypted_token,token_expires_at=excluded.token_expires_at,last_refreshed_at=excluded.last_refreshed_at,refresh_error=NULL,refresh_lock_until=0
        WHERE instagram_connection.user_id=excluded.user_id`,
      ).bind(
        result.profile.user_id,
        result.oauthUserId,
        result.appScopedId,
        result.profile.username,
        encrypted,
        now,
        now + result.expiresIn * 1000,
        now,
      ),
      env.DB.prepare(
        'INSERT INTO sessions(session_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)',
      ).bind(
        await hash(sessionSecret),
        result.profile.user_id,
        csrf,
        now + 30 * DAY,
      ),
    ])
    return redirect(`${env.APP_ORIGIN}/?instagram_connected=1#overview`, [
      expiredCookie,
      cookie(SESSION_COOKIE, sessionSecret, 30 * 86400),
    ])
  } catch (error) {
    return finishError(
      error instanceof ConnectionError ? error.code : 'authorization_failed',
    )
  }
}
async function clearConnection(env: Env, userId: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare(
      'DELETE FROM instagram_connection WHERE id = 1 AND user_id = ?',
    ).bind(userId),
  ])
}
async function deletion(request: Request, env: Env) {
  if (!env.INSTAGRAM_APP_SECRET)
    throw new ConnectionError('server_not_configured', 503)
  const form = await request.formData()
  const value = form.get('signed_request')
  if (typeof value !== 'string')
    throw new ConnectionError('invalid_signature', 403)
  const userId = await signedRequest(value, env.INSTAGRAM_APP_SECRET)
  const account = await env.DB.prepare(
    'SELECT user_id FROM instagram_connection WHERE id=1 AND (user_id=? OR oauth_user_id=? OR app_scoped_id=?)',
  )
    .bind(userId, userId, userId)
    .first<{ user_id: string }>()
  if (account) await clearConnection(env, account.user_id)
  const code = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO deletion_confirmations(code,created_at) VALUES (?,?)',
  )
    .bind(code, Date.now())
    .run()
  return json({
    url: `${env.APP_ORIGIN}/data-deletion?code=${code}`,
    confirmation_code: code,
  })
}
async function api(request: Request, env: Env) {
  const path = new URL(request.url).pathname
  if (request.method === 'OPTIONS')
    throw new ConnectionError('origin_not_allowed', 403)
  if (path === '/api/performance' && request.method === 'GET')
    return reviewedPerformance(env.DB)
  if (path === '/api/media' && request.method === 'GET')
    return mediaFeed(request, env.DB)
  if (path === '/api/connection' && request.method === 'GET')
    return status(request, env)
  if (path === '/api/auth/instagram/start' && request.method === 'POST')
    return start(request, env)
  if (path === '/api/auth/instagram/callback' && request.method === 'GET')
    return callback(request, env)
  if (
    (path === '/api/data-deletion' ||
      path === '/api/auth/instagram/deauthorize') &&
    request.method === 'POST'
  )
    return deletion(request, env)
  if (path.startsWith('/api/data-deletion/') && request.method === 'GET') {
    const code = path.slice('/api/data-deletion/'.length)
    const row = await env.DB.prepare(
      'SELECT created_at FROM deletion_confirmations WHERE code=?',
    )
      .bind(code)
      .first<{ created_at: number }>()
    return row
      ? json({ status: 'deleted', deletedAt: row.created_at })
      : json({ error: { code: 'not_found' } }, 404)
  }
  if (path === '/api/connection' && request.method === 'DELETE') {
    const auth = await owner(request, env)
    await clearConnection(env, auth.user.user_id)
    return json({ disconnected: true })
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    await owner(request, env)
    await env.DB.prepare('DELETE FROM sessions WHERE session_hash=?')
      .bind(await hash(readCookie(request, SESSION_COOKIE)))
      .run()
    const response = json({ loggedOut: true })
    response.headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0))
    return response
  }
  return json({ error: { code: 'not_found' } }, 404)
}

export async function maintainConnection(env: Env) {
  if (!configuration(env)) return
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
    env.DB.prepare(
      'DELETE FROM deletion_confirmations WHERE created_at<?',
    ).bind(now - 30 * DAY),
  ])
  const row = await env.DB.prepare(
    'SELECT * FROM instagram_connection WHERE id=1',
  ).first<ConnectionRow>()
  if (
    !row ||
    row.token_expires_at > now + 14 * DAY ||
    row.last_refreshed_at > now - DAY
  )
    return
  if (row.token_expires_at <= now) {
    await env.DB.prepare(
      "UPDATE instagram_connection SET refresh_error='token_expired' WHERE id=1",
    ).run()
    return
  }
  const lock = await env.DB.prepare(
    'UPDATE instagram_connection SET refresh_lock_until=? WHERE id=1 AND refresh_lock_until<? AND encrypted_token=?',
  )
    .bind(now + 300000, now, row.encrypted_token)
    .run()
  if (!lock.meta.changes) return
  try {
    const updated = await refreshToken(
      await decryptToken(row.encrypted_token, env.TOKEN_ENCRYPTION_KEY),
    )
    await env.DB.prepare(
      'UPDATE instagram_connection SET encrypted_token=?,token_expires_at=?,last_refreshed_at=?,refresh_error=NULL,refresh_lock_until=0 WHERE id=1 AND encrypted_token=?',
    )
      .bind(
        await encryptToken(updated.access_token, env.TOKEN_ENCRYPTION_KEY),
        now + updated.expires_in! * 1000,
        now,
        row.encrypted_token,
      )
      .run()
  } catch (error) {
    await env.DB.prepare(
      'UPDATE instagram_connection SET refresh_error=?,refresh_lock_until=0 WHERE id=1 AND encrypted_token=?',
    )
      .bind(
        error instanceof ConnectionError ? error.code : 'refresh_failed',
        row.encrypted_token,
      )
      .run()
  }
}

export default {
  async fetch(request: Request, env: Env) {
    let response: Response
    try {
      response = new URL(request.url).pathname.startsWith('/api/')
        ? await api(request, env)
        : env.ASSETS
          ? await env.ASSETS.fetch(request)
          : new Response('JB Golf connection service', { status: 200 })
    } catch (error) {
      response = json(
        {
          error: {
            code:
              error instanceof ConnectionError ? error.code : 'internal_error',
          },
        },
        error instanceof ConnectionError ? error.status : 500,
      )
    }
    const secured = new Response(response.body, response)
    secured.headers.set('X-Content-Type-Options', 'nosniff')
    secured.headers.set('Referrer-Policy', 'no-referrer')
    secured.headers.set('X-Frame-Options', 'DENY')
    return secured
  },
  async scheduled(_event: unknown, env: Env) {
    await maintainConnection(env)
  },
}
