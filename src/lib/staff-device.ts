export async function readStaffSession(signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/staff/session', {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('staff_session_unavailable')
  const session = await response.json()
  if (session.authenticated === false) return ''
  if (
    session.authenticated === true &&
    typeof session.csrfToken === 'string' &&
    session.csrfToken
  )
    return session.csrfToken
  throw new Error('staff_session_unavailable')
}

export async function activateStaffDevice(token: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return ''
  const response = await fetch('/api/staff/activate', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(12000),
  })
  // A previously redeemed link can still be opened in the paired browser.
  if (!response.ok && response.status !== 401)
    throw new Error('staff_activation_unavailable')
  const csrf = await readStaffSession()
  if (response.ok && !csrf) throw new Error('staff_cookie_unavailable')
  return csrf
}
