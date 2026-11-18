import type { Env } from './types'
import { hash, randomSecret } from './crypto'
import { CalendarError } from './calendar-schedules'

const lifetime = 30 * 86_400_000
const digestFor = (token: string) => hash('calendar-view:' + token)
export const THUMBNAIL_COOKIE = '__Secure-jbgolf_calendar_thumbnails'
export const SHARED_THUMBNAIL_PATH = '/api/calendar/view/thumbnail/'

export async function calendarShareStatus(env: Env) {
  const grant = await env.DB.prepare(
    'SELECT expires_at FROM calendar_read_grant WHERE id=1 AND expires_at>?',
  )
    .bind(Date.now())
    .first<{ expires_at: number }>()
  return { expiresAt: grant ? new Date(grant.expires_at).toISOString() : null }
}

export async function rotateCalendarShare(env: Env) {
  const token = randomSecret()
  const until = Date.now() + lifetime
  await env.DB.prepare(
    'INSERT INTO calendar_read_grant(id,token_digest,expires_at) VALUES(1,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET token_digest=excluded.token_digest, expires_at=excluded.expires_at',
  )
    .bind(await digestFor(token), until)
    .run()
  return { token, expiresAt: new Date(until).toISOString() }
}

export async function revokeCalendarShare(env: Env) {
  await env.DB.prepare('DELETE FROM calendar_read_grant WHERE id=1').run()
  return { deleted: true }
}

export async function validateCalendarShare(env: Env, token: string) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token))
    throw new CalendarError('share_unavailable', 401)
  const grant = await env.DB.prepare(
    'SELECT expires_at FROM calendar_read_grant WHERE id=1 AND token_digest=? AND expires_at>?',
  )
    .bind(await digestFor(token), Date.now())
    .first<{ expires_at: number }>()
  if (!grant) throw new CalendarError('share_unavailable', 401)
  return grant.expires_at
}

export function thumbnailCookie(token: string, expiry: number) {
  const seconds = Math.min(
    3600,
    Math.max(0, Math.floor((expiry - Date.now()) / 1000)),
  )
  return (
    THUMBNAIL_COOKIE +
    '=' +
    token +
    '; Path=' +
    SHARED_THUMBNAIL_PATH +
    '; HttpOnly; Secure; SameSite=Strict; Max-Age=' +
    seconds
  )
}
