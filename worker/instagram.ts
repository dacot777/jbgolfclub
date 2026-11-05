import type { Env } from './types'
import { ConnectionError } from './types'
import { decodeBase64 } from './crypto'
import { parseInstagramJson } from './json'

type Token = {
  access_token: string
  expires_in?: number
  user_id?: string | number
}
type Profile = { user_id: string; username: string; id?: string }
const CALLBACK = '/api/auth/instagram/callback'
export const normalizeUsername = (value: string) =>
  value.trim().replace(/^@/, '').toLowerCase()

export function configuration(env: Env) {
  try {
    const origin = new URL(env.APP_ORIGIN)
    return (
      origin.protocol === 'https:' &&
      origin.origin === env.APP_ORIGIN &&
      /^\d+$/.test(env.INSTAGRAM_APP_ID) &&
      Boolean(env.INSTAGRAM_APP_SECRET) &&
      /^[a-z0-9._]{1,30}$/.test(
        normalizeUsername(env.INSTAGRAM_ACCOUNT_USERNAME),
      ) &&
      /^v\d+\.0$/.test(env.INSTAGRAM_API_VERSION) &&
      decodeBase64(env.TOKEN_ENCRYPTION_KEY).byteLength === 32
    )
  } catch {
    return false
  }
}
export function authorizationUrl(env: Env, state: string) {
  const url = new URL('https://www.instagram.com/oauth/authorize')
  url.search = new URLSearchParams({
    client_id: env.INSTAGRAM_APP_ID,
    redirect_uri: env.APP_ORIGIN + CALLBACK,
    response_type: 'code',
    scope: 'instagram_business_basic',
    state,
    enable_fb_login: '0',
    force_authentication: '1',
  }).toString()
  return url.toString()
}
async function requestJson<T>(
  url: URL | string,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  } catch {
    throw new ConnectionError('instagram_unreachable', 502)
  }
  let data: unknown
  try {
    data = parseInstagramJson(await response.text())
  } catch {
    throw new ConnectionError('instagram_invalid_response', 502)
  }
  if (response.status >= 500)
    throw new ConnectionError('instagram_unreachable', 502)
  if (response.status === 429)
    throw new ConnectionError('instagram_rate_limited', 429)
  if (
    !response.ok ||
    (typeof data === 'object' && data !== null && 'error' in data)
  )
    throw new ConnectionError('instagram_authorization_failed', 502)
  return data as T
}
function tokenResponse(token: Token, requireExpiry = false) {
  if (
    typeof token.access_token !== 'string' ||
    token.access_token.length < 8 ||
    (requireExpiry &&
      (!Number.isFinite(token.expires_in) || token.expires_in! <= 0))
  )
    throw new ConnectionError('instagram_invalid_response', 502)
  return token
}
export async function exchangeCode(env: Env, code: string) {
  const short = tokenResponse(
    await requestJson<Token>('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.INSTAGRAM_APP_ID,
        client_secret: env.INSTAGRAM_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: env.APP_ORIGIN + CALLBACK,
        code,
      }),
    }),
  )
  const url = new URL('https://graph.instagram.com/access_token')
  url.search = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: env.INSTAGRAM_APP_SECRET,
    access_token: short.access_token,
  }).toString()
  const long = tokenResponse(await requestJson<Token>(url), true)
  const profileUrl = new URL(
    `https://graph.instagram.com/${env.INSTAGRAM_API_VERSION}/me`,
  )
  profileUrl.search = new URLSearchParams({
    fields: 'id,user_id,username',
    access_token: long.access_token,
  }).toString()
  const profile = await requestJson<Profile>(profileUrl)
  if (
    !/^\d+$/.test(String(profile.user_id ?? '')) ||
    typeof profile.username !== 'string'
  )
    throw new ConnectionError('instagram_invalid_response', 502)
  if (
    normalizeUsername(profile.username) !==
    normalizeUsername(env.INSTAGRAM_ACCOUNT_USERNAME)
  )
    throw new ConnectionError('different_instagram_account', 403)
  return {
    token: long.access_token,
    expiresIn: long.expires_in!,
    profile: { user_id: String(profile.user_id), username: profile.username },
    oauthUserId: short.user_id ? String(short.user_id) : null,
    appScopedId: profile.id ? String(profile.id) : null,
  }
}
export async function refreshToken(token: string) {
  const url = new URL('https://graph.instagram.com/refresh_access_token')
  url.search = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: token,
  }).toString()
  return tokenResponse(await requestJson<Token>(url), true)
}
