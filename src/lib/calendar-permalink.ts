import type { CalendarAccount, CalendarKind } from './calendar-types'

export function parseCalendarPermalink(
  value: unknown,
  account: CalendarAccount,
) {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value.trim())
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['www.instagram.com', 'instagram.com'].includes(url.hostname)
    )
      return null
    const match =
      /^\/(?:(?<handle>[a-z0-9._]+)\/)?(?<type>p|reel|reels)\/(?<code>[A-Za-z0-9_-]{1,64})\/?$/i.exec(
        url.pathname,
      )
    if (
      !match?.groups ||
      (match.groups.handle && match.groups.handle.toLowerCase() !== account)
    )
      return null
    const kind: CalendarKind =
      match.groups.type.toLowerCase() === 'p' ? 'post' : 'reel'
    const shortcode = match.groups.code
    return {
      kind,
      shortcode,
      permalink:
        'https://www.instagram.com/' +
        (kind === 'post' ? 'p/' : 'reel/') +
        shortcode +
        '/',
    }
  } catch {
    return null
  }
}
