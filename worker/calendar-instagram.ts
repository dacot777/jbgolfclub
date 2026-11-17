import {
  CALENDAR_ACCOUNTS,
  isCalendarAccount,
  type CalendarAccount,
  type CalendarAccountStatus,
  type CalendarPost,
} from '../src/lib/calendar-types'
import { encryptToken, equal, hash, randomSecret } from './crypto'
import { authorizationUrl, configuration, exchangeCode } from './instagram'
import {
  calendarTokenContext,
  syncCalendarAccount,
} from './calendar-instagram-feed'
import type { Env } from './types'
import { ConnectionError } from './types'
import { staffSession } from './staff-access'
export {
  calendarInstagramThumbnail,
  syncCalendarInstagram,
} from './calendar-instagram-feed'

export const CALENDAR_INSTAGRAM_CALLBACK =
  '/api/auth/instagram/calendar/callback'
const COOKIE = '__Host-jbgolf_calendar_state'

function stateCookie(value: string, maxAge: number) {
  return (
    COOKIE +
    '=' +
    value +
    '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' +
    maxAge
  )
}
function json(value: unknown, status: number, cookie?: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  if (cookie) headers.set('Set-Cookie', cookie)
  return new Response(JSON.stringify(value), { status, headers })
}

export async function startCalendarInstagram(
  env: Env,
  account: string,
  sessionHash: string,
) {
  if (!isCalendarAccount(account))
    return json({ error: { code: 'invalid_account' } }, 400)
  if (!configuration({ ...env, INSTAGRAM_ACCOUNT_USERNAME: account }))
    return json({ error: { code: 'server_not_configured' } }, 503)
  const state = randomSecret()
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM calendar_instagram_states WHERE expires_at<=?',
    ).bind(now),
    env.DB.prepare(
      `INSERT INTO calendar_instagram_states(state_hash, session_hash,account,expires_at) VALUES(?,?,?,?)
      ON CONFLICT(session_hash) DO UPDATE SET state_hash=excluded.state_hash, account=excluded.account, expires_at=excluded.expires_at`,
    ).bind(await hash(state), sessionHash, account, now + 600000),
  ])
  return json(
    { url: authorizationUrl(env, state, CALENDAR_INSTAGRAM_CALLBACK) },
    200,
    stateCookie(state, 600),
  )
}

export async function calendarInstagramCallback(request: Request, env: Env) {
  function finish(result: string) {
    return new Response(null, {
      status: 303,
      headers: {
        Location:
          env.APP_ORIGIN +
          '/?calendar_instagram=' +
          encodeURIComponent(result) +
          '#calendar',
        'Cache-Control': 'no-store',
        'Set-Cookie': stateCookie('', 0),
      },
    })
  }
  const url = new URL(request.url)
  const state = url.searchParams.get('state') ?? ''
  const cookie = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1)
  if (!state || !cookie || !equal(state, cookie)) return finish('invalid_state')
  const session = await staffSession(request, env)
  if (!session) return finish('expired_state')
  const now = Date.now()
  const pending = await env.DB.prepare(
    `DELETE FROM calendar_instagram_states WHERE state_hash=? AND expires_at>?
    AND session_hash=? RETURNING account,session_hash`,
  )
    .bind(await hash(state), now, session.session_hash)
    .first<{ account: string; session_hash: string }>()
  if (!pending || !isCalendarAccount(pending.account))
    return finish('expired_state')
  if (url.searchParams.has('error')) return finish('authorization_cancelled')
  const code = url.searchParams.get('code')
  if (!code || code.length > 4096) return finish('authorization_failed')
  const account = pending.account
  try {
    const target = { ...env, INSTAGRAM_ACCOUNT_USERNAME: account }
    if (!configuration(target)) return finish('server_not_configured')
    const verified = await exchangeCode(
      target,
      code,
      CALENDAR_INSTAGRAM_CALLBACK,
    )
    const uid = verified.profile.user_id
    const encrypted = await encryptToken(
      verified.token,
      env.TOKEN_ENCRYPTION_KEY,
      calendarTokenContext(account, uid),
    )
    // Keep the first verified numeric ID bound to its handle across reconnects.
    const saved = await env.DB.prepare(
      `INSERT INTO calendar_instagram_accounts(account,user_id,oauth_user_id,app_scoped_id,
      encrypted_token,token_expires_at,refreshed_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM staff_sessions WHERE session_hash=? AND expires_at>?)
      ON CONFLICT(account) DO UPDATE SET oauth_user_id=excluded.oauth_user_id,app_scoped_id=excluded.app_scoped_id,
      encrypted_token=excluded.encrypted_token,token_expires_at=excluded.token_expires_at,refreshed_at=excluded.refreshed_at,
      sync_error=NULL,lease=NULL,lease_until=0
      WHERE calendar_instagram_accounts.user_id=excluded.user_id
      ON CONFLICT(user_id) DO NOTHING`,
    )
      .bind(
        account,
        uid,
        verified.oauthUserId,
        verified.appScopedId,
        encrypted,
        now + verified.expiresIn * 1000,
        now,
        pending.session_hash,
        Date.now(),
      )
      .run()
    if (!saved.meta.changes) return finish('different_instagram_account')
    await syncCalendarAccount(env, account)
    return finish('connected')
  } catch (e) {
    return finish(
      e instanceof ConnectionError ? e.code : 'authorization_failed',
    )
  }
}

export async function readCalendarMedia(env: Env, month: string) {
  const [postsResult, grantsResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id,account,kind,title,date,time,permalink,
      CASE WHEN thumbnail_url IS NOT NULL OR use_album_child THEN '/api/admin/calendar/instagram/thumbnail/' || id ELSE NULL END AS thumbnailUrl
      FROM calendar_instagram_media WHERE date>=? AND date<=? ORDER BY date,time,id`,
    ).bind(month + '-01', month + '-31'),
    env.DB.prepare(
      'SELECT account,token_expires_at,last_synced_at,sync_error,completed_at FROM calendar_instagram_accounts',
    ),
  ])
  type GrantStatus = {
    account: CalendarAccount
    token_expires_at: number
    last_synced_at: number | null
    sync_error: string | null
    completed_at: number | null
  }
  const grants = grantsResult.results as GrantStatus[]
  const accounts: CalendarAccountStatus[] = CALENDAR_ACCOUNTS.map((account) => {
    const grant = grants.find((row) => row.account === account)
    let status: CalendarAccountStatus['status']
    if (!configuration({ ...env, INSTAGRAM_ACCOUNT_USERNAME: account }))
      status = 'setup_required'
    else if (
      !grant ||
      grant.token_expires_at <= Date.now() ||
      ['token_expired', 'instagram_authorization_failed'].includes(
        grant.sync_error ?? '',
      )
    )
      status = 'needs_connection'
    else if (grant.sync_error) status = 'error'
    else status = grant.completed_at ? 'connected' : 'syncing'
    return {
      account,
      status,
      lastSyncedAt: grant?.last_synced_at
        ? new Date(grant.last_synced_at).toISOString()
        : null,
    }
  })
  return { posts: postsResult.results as unknown as CalendarPost[], accounts }
}
