import type { MediaCandidate } from '../src/lib/media-types'

const MAX_BODY = 2 * 1024 * 1024
const MAX_ITEMS = 10

function entities(value: string) {
  return value.replace(
    /&(?:#(x[0-9a-f]+|\d+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (_, code: string | undefined, name: string | undefined) => {
      if (code) {
        const point = code.toLowerCase().startsWith('x')
          ? parseInt(code.slice(1), 16)
          : parseInt(code, 10)
        return point <= 0x10ffff ? String.fromCodePoint(point) : ''
      }
      return (
        { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[
          name!.toLowerCase()
        ] || ''
      )
    },
  )
}

function cleanText(value: string) {
  return entities(value.replace(/<[^>]*>/g, ' '))
    .replace(/새\s*창\s*열림/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function publicUrl(value: string): string | null {
  try {
    const url = new URL(entities(value))
    const hostname = url.hostname.toLowerCase()
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      value.length > 3000 ||
      !hostname.includes('.') ||
      hostname.includes(':') ||
      /^\d+(?:\.\d+){3}$/.test(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(hostname)
    )
      return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function thumbnail(value: string) {
  const safe = publicUrl(value)
  if (!safe) return null
  const url = new URL(safe)
  if (url.hostname === 'search.pstatic.net') {
    const original = url.searchParams.get('src')
    if (original) return publicUrl(original)
  }
  return safe
}

async function limitedText(response: Response) {
  if (
    !response.ok ||
    Number(response.headers.get('Content-Length') || 0) > MAX_BODY
  )
    throw new Error('News source unavailable')
  if (!response.body) throw new Error('News source unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > MAX_BODY) {
        await reader.cancel()
        throw new Error('News response too large')
      }
      chunks.push(part.value)
    }
  } finally {
    reader.releaseLock()
  }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return new TextDecoder().decode(data)
}

async function sourceText(url: string, accept: string, timeout = 9000) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      'User-Agent': 'Mozilla/5.0 (compatible; JBGolfMedia/1.0)',
    },
    signal: AbortSignal.timeout(timeout),
    redirect: 'manual',
  })
  return limitedText(response)
}

/** Main Naver cards have their publisher before the headline. Related mini-cards
 * have another ordering and are deliberately excluded to avoid misattribution. */
export async function parseNaverNews(
  html: string,
  keyword: string,
): Promise<MediaCandidate[]> {
  if (
    html.length > MAX_BODY ||
    /<title\b[^>]*>[^<]*(?:captcha|자동입력\s*방지|access denied|접근\s*제한)/i.test(
      html,
    )
  )
    throw new Error('News source unavailable')
  const items = new Map<string, MediaCandidate>()
  let publisher = ''
  let publisherBuffer = ''
  let skipRelatedPublisher = false
  let title: {
    url: string | null
    text: string
    publisher: string
    main: boolean
  } | null = null
  let description: { url: string | null; text: string } | null = null
  let imageUrl: string | null = null
  let sawTitleAnchors = false
  let sawSearchLayout =
    /main_pack|네이버 뉴스검색|검색결과가 없습니다|검색 결과가 없습니다/.test(
      html,
    )
  const rewriter = new HTMLRewriter()
    .on('.sds-comps-profile-info-title-text', {
      element(element) {
        publisherBuffer = ''
        element.onEndTag(() => {
          const name = cleanText(publisherBuffer)
          if (skipRelatedPublisher) skipRelatedPublisher = false
          else if (name) publisher = name.slice(0, 200)
        })
      },
      text(chunk) {
        publisherBuffer += chunk.text
      },
    })
    .on('a[data-heatmap-target=".tit"]', {
      element(element) {
        sawSearchLayout = true
        sawTitleAnchors = true
        title = {
          url: publicUrl(element.getAttribute('href') || ''),
          text: '',
          publisher,
          main: false,
        }
        const active = title
        element.onEndTag(() => {
          if (active.main && active.url && items.size < MAX_ITEMS) {
            const headline = cleanText(active.text).slice(0, 500)
            if (headline)
              items.set(active.url, {
                title: headline,
                url: active.url,
                publisher:
                  active.publisher ||
                  new URL(active.url).hostname.replace(/^www\./, ''),
                author: null,
                thumbnailUrl: null,
                publishedAt: null,
                matchedKeywords: [keyword],
                searchText: headline,
              })
          }
          if (active.main) publisher = ''
          else skipRelatedPublisher = true
          if (title === active) title = null
        })
      },
      text(chunk) {
        if (title) title.text += chunk.text
      },
    })
    .on('a[data-heatmap-target=".tit"] .sds-comps-text-type-headline1', {
      element() {
        if (title) title.main = true
      },
    })
    .on('a[data-heatmap-target=".body"]', {
      element(element) {
        description = {
          url: publicUrl(element.getAttribute('href') || ''),
          text: '',
        }
        const active = description
        element.onEndTag(() => {
          const item = active.url ? items.get(active.url) : undefined
          if (item)
            item.searchText = `${item.title} ${cleanText(active.text)}`.slice(
              0,
              2500,
            )
          if (description === active) description = null
        })
      },
      text(chunk) {
        if (description) description.text += chunk.text
      },
    })
    .on('a[data-heatmap-target=".img"]', {
      element(element) {
        imageUrl = publicUrl(element.getAttribute('href') || '')
        element.onEndTag(() => {
          imageUrl = null
        })
      },
    })
    .on('a[data-heatmap-target=".img"] img', {
      element(element) {
        const item = imageUrl ? items.get(imageUrl) : undefined
        if (item)
          item.thumbnailUrl = thumbnail(
            element.getAttribute('src') ||
              element.getAttribute('data-src') ||
              '',
          )
      },
    })
  await rewriter
    .transform(
      new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    )
    .text()
  if (!sawSearchLayout) throw new Error('News search layout unavailable')
  if (
    !items.size &&
    (sawTitleAnchors || /class=["'][^"']*\bnews_tit\b/.test(html))
  )
    throw new Error('News card layout unavailable')
  return [...items.values()]
}

function xmlText(value: string) {
  return cleanText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

export function parseBingNews(xml: string, keyword: string): MediaCandidate[] {
  if (xml.length > MAX_BODY || !/<rss\b/i.test(xml) || !/<channel\b/i.test(xml))
    throw new Error('News RSS unavailable')
  const results: MediaCandidate[] = []
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const raw = match[1]
    const tag = (name: string) =>
      xmlText(
        new RegExp(
          `<(?:[A-Za-z0-9_]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${name}>`,
          'i',
        ).exec(raw)?.[1] || '',
      )
    const headline = tag('title')
    let url = publicUrl(tag('link'))
    if (url) {
      const parsed = new URL(url)
      if (parsed.hostname === 'www.bing.com' || parsed.hostname === 'bing.com')
        url = publicUrl(parsed.searchParams.get('url') || '')
    }
    if (!headline || !url) continue
    const published = tag('pubDate')
    const source = tag('Source')
    results.push({
      title: headline.slice(0, 500),
      url,
      publisher: source || new URL(url).hostname.replace(/^www\./, ''),
      author: null,
      thumbnailUrl: thumbnail(tag('Image')),
      publishedAt:
        published && Number.isFinite(Date.parse(published))
          ? new Date(published).toISOString()
          : null,
      matchedKeywords: [keyword],
      searchText: `${headline} ${tag('description')}`.slice(0, 2500),
    })
    if (results.length >= MAX_ITEMS) break
  }
  return results
}

/** One keyword per request step; both sources are public and need no API key. */
export async function searchNews(keyword: string): Promise<MediaCandidate[]> {
  try {
    const url = `https://search.naver.com/search.naver?where=news&sort=1&query=${encodeURIComponent(keyword)}`
    return await parseNaverNews(
      await sourceText(url, 'text/html', 5500),
      keyword,
    )
  } catch {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(`"${keyword}"`)}&format=rss&setlang=ko-KR`
    return parseBingNews(
      await sourceText(
        url,
        'application/rss+xml, application/xml, text/xml',
        3500,
      ),
      keyword,
    )
  }
}
