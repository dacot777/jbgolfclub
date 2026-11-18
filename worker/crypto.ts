import { ConnectionError } from './types'
import { parseInstagramJson } from './json'

const encoder = new TextEncoder()
export function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}
export function decodeBase64(value: string) {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
    return Uint8Array.from(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
      (c) => c.charCodeAt(0),
    )
  } catch {
    throw new ConnectionError('invalid_encoding')
  }
}
export function randomSecret() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}
export async function hash(value: string) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  )
}
export function equal(a: string, b: string) {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++)
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}
async function tokenKey(secret: string) {
  const key = decodeBase64(secret)
  if (key.byteLength !== 32)
    throw new ConnectionError('server_not_configured', 503)
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}
export async function encryptToken(
  token: string,
  secret: string,
  context = 'jbgolf:instagram:single:v1',
) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(context),
    },
    await tokenKey(secret),
    encoder.encode(token),
  )
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`
}
export async function decryptToken(
  value: string,
  secret: string,
  context = 'jbgolf:instagram:single:v1',
) {
  const [version, iv, data] = value.split('.')
  if (version !== 'v1' || !iv || !data)
    throw new ConnectionError('invalid_ciphertext', 500)
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decodeBase64(iv),
        additionalData: encoder.encode(context),
      },
      await tokenKey(secret),
      decodeBase64(data),
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new ConnectionError('token_unavailable', 503)
  }
}
export async function signedRequest(value: string, secret: string) {
  const [signature, payload, extra] = value.split('.')
  if (!signature || !payload || extra)
    throw new ConnectionError('invalid_signature', 403)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64(signature),
      encoder.encode(payload),
    ))
  )
    throw new ConnectionError('invalid_signature', 403)
  let decoded: { algorithm?: string; user_id?: string; issued_at?: number }
  try {
    decoded = parseInstagramJson(
      new TextDecoder().decode(decodeBase64(payload)),
    ) as typeof decoded
  } catch {
    throw new ConnectionError('invalid_signature', 403)
  }
  if (
    decoded.algorithm?.toUpperCase() !== 'HMAC-SHA256' ||
    !/^\d+$/.test(String(decoded.user_id ?? ''))
  )
    throw new ConnectionError('invalid_signature', 403)
  return String(decoded.user_id)
}
