import type { Env } from './types'

const BODY_LIMIT = 2048
export class PrivateRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}

export function json(value: unknown, status = 200, cookie?: string) {
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
export function empty(cookie?: string) {
  const headers = new Headers({ 'Cache-Control': 'no-store, private' })
  if (cookie) headers.set('Set-Cookie', cookie)
  return new Response(null, { status: 204, headers })
}
export function cookie(
  name: string,
  value: string,
  seconds: number,
  strict = true,
) {
  return `${name}=${value}; HttpOnly; Secure; SameSite=${strict ? 'Strict' : 'Lax'}; Path=/; Max-Age=${seconds}`
}
export function readCookie(request: Request, name: string) {
  return (
    (request.headers.get('Cookie') ?? '')
      .split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  )
}
export function sameOrigin(request: Request, env: Env) {
  if (
    new URL(request.url).origin !== env.APP_ORIGIN ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('Sec-Fetch-Site') === 'cross-site'
  )
    throw new PrivateRequestError('origin_not_allowed', 403)
}
export async function body(
  request: Request,
  maxBytes = BODY_LIMIT,
): Promise<Record<string, unknown>> {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new PrivateRequestError('invalid_request', 400)
  if (
    Number(request.headers.get('Content-Length') ?? 0) > maxBytes ||
    !request.body
  )
    throw new PrivateRequestError('invalid_request', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const part = await reader.read()
    if (part.done) break
    length += part.value.length
    if (length > maxBytes) {
      await reader.cancel()
      throw new PrivateRequestError('invalid_request', 400)
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
    throw new PrivateRequestError('invalid_request', 400)
  }
}
