import {
  COMPANY_MEDIA_KEYWORDS,
  type MediaCandidate,
} from '../src/lib/media-types'

const SEARCH_LIMIT = 2 * 1024 * 1024
const POST_LIMIT = 1024 * 1024
const CARD = '[data-template-id="ugcItem"]'

function decodeEntities(value: string) {
  const names: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
  }
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|hellip|ndash|mdash|lsquo|rsquo|ldquo|rdquo);/gi,
    (entity, key: string) => {
      if (!key.startsWith('#')) return names[key.toLowerCase()] ?? entity
      const number = key.toLowerCase().startsWith('#x')
        ? Number.parseInt(key.slice(2), 16)
        : Number.parseInt(key.slice(1), 10)
      return number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : '�'
    },
  )
}

function clean(value: string, max = 1000) {
  return decodeEntities(value)
    .replace(/새 창 열림/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function publicUrl(raw: string | null): string | null {
  if (!raw || raw.length > 4000) return null
  try {
    const url = new URL(decodeEntities(raw))
    const host = url.hostname.toLowerCase().replace(/\.+$/, '')
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.includes(':') ||
      /^\d+(?:\.\d+){0,3}$/.test(host)
    )
      return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()])
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    return url.href
  } catch {
    return null
  }
}

function canonicalPost(raw: string | null): string | null {
  const safe = publicUrl(raw)
  if (!safe) return null
  const url = new URL(safe)
  if (
    url.hostname === 'blog.naver.com' ||
    url.hostname === 'm.blog.naver.com'
  ) {
    const direct = url.pathname.match(
      /^\/([A-Za-z0-9_.-]{1,100})\/(\d{1,20})\/?$/,
    )
    if (direct) return `https://blog.naver.com/${direct[1]}/${direct[2]}`
    if (url.pathname.toLowerCase() === '/postview.naver') {
      const id = url.searchParams.get('blogId') ?? ''
      const post = url.searchParams.get('logNo') ?? ''
      if (/^[A-Za-z0-9_.-]{1,100}$/.test(id) && /^\d{1,20}$/.test(post))
        return `https://blog.naver.com/${id}/${post}`
    }
    return null
  }
  return safe
}

function imageUrl(raw: string | null): string | null {
  const safe = publicUrl(raw)
  return safe?.startsWith('https:') ? safe : null
}

function exactDate(raw: string): string | null {
  const match = clean(raw).match(
    /(?:^|\s)(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})(?:\.|\s|$)/,
  )
  if (!match) return null
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day
    ? day
    : null
}

const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
function matchedKeywords(value: string) {
  const normalized = normalize(value)
  const matches = COMPANY_MEDIA_KEYWORDS.filter((keyword) =>
    normalized.includes(normalize(keyword)),
  )
  // The short academy name is also used by unrelated schools. Require the sport context.
  if (
    matches.length &&
    matches.every((keyword) =>
      ['JB아카데미', 'JB ACADEMY'].includes(keyword),
    ) &&
    !/(?:골프|golf|퍼팅|putting)/i.test(value)
  )
    return []
  return matches
}

function capped(response: Response, limit: number): Response {
  if (
    !response.body ||
    Number(response.headers.get('Content-Length') ?? 0) > limit
  )
    throw new Error('blog_source_too_large')
  const reader = response.body.getReader()
  let size = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) {
            controller.close()
            return
          }
          size += chunk.value.byteLength
          if (size > limit) {
            await reader.cancel()
            controller.error(new Error('blog_source_too_large'))
            return
          }
          controller.enqueue(chunk.value)
        } catch (error) {
          controller.error(error)
        }
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    }),
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

type ParsedCard = {
  title: string
  url: string | null
  publisher: string
  image: string | null
  snippet: string
  date: string
}

/** Semantic Naver search-card parsing; no dependence on generated CSS class names. */
export async function parseBlogSearch(
  response: Response,
): Promise<MediaCandidate[]> {
  const cards: ParsedCard[] = []
  let current: ParsedCard | null = null
  let postAnchor: string | null = null
  let cardCount = 0
  let noResults = false
  let title = ''
  const parser = new HTMLRewriter()
    .on('title', {
      text(chunk) {
        if (title.length < 500) title += chunk.text
      },
    })
    .on('#notfound, .api_noresult_wrap', {
      element() {
        noResults = true
      },
    })
    .on(CARD, {
      element(element) {
        cardCount++
        const card: ParsedCard = {
          title: '',
          url: null,
          publisher: '',
          image: null,
          snippet: '',
          date: '',
        }
        current = card
        element.onEndTag(() => {
          cards.push(card)
          if (current === card) current = null
          postAnchor = null
        })
      },
    })
    .on(`${CARD} a`, {
      element(element) {
        postAnchor = canonicalPost(element.getAttribute('href'))
        element.onEndTag(() => {
          postAnchor = null
        })
      },
    })
    .on(`${CARD} .sds-comps-text-type-headline1`, {
      element() {
        if (current && postAnchor) current.url = postAnchor
      },
      text(chunk) {
        if (current && current.title.length < 2000) current.title += chunk.text
      },
    })
    .on(`${CARD} .sds-comps-text-type-body1`, {
      text(chunk) {
        if (current && current.snippet.length < 8000)
          current.snippet += chunk.text
      },
    })
    .on(`${CARD} [data-heatmap-target="articleSourceJSX_title"]`, {
      text(chunk) {
        if (current && current.publisher.length < 1000)
          current.publisher += chunk.text
      },
    })
    .on(`${CARD} .sds-comps-profile-info-subtext`, {
      text(chunk) {
        if (current && current.date.length < 200) current.date += chunk.text
      },
    })
    .on(`${CARD} a img`, {
      element(element) {
        if (
          current &&
          postAnchor &&
          postAnchor === current.url &&
          !current.image
        )
          current.image =
            imageUrl(element.getAttribute('src')) ??
            imageUrl(element.getAttribute('data-src'))
      },
    })
  await parser.transform(capped(response, SEARCH_LIMIT)).arrayBuffer()
  if (
    /captcha|보안\s*확인|접근\s*제한|비정상적인\s*접근/i.test(title) ||
    (!cardCount && !noResults)
  )
    throw new Error('blog_source_unavailable')
  if (cardCount && cards.every((card) => !clean(card.title) || !card.url))
    throw new Error('blog_source_unavailable')
  const unique = new Map<string, MediaCandidate>()
  for (const card of cards) {
    const cardTitle = clean(card.title, 400)
    const publisher = clean(card.publisher, 200)
    const snippet = clean(card.snippet, 2000)
    if (!card.url || !cardTitle) continue
    const matches = matchedKeywords(`${cardTitle} ${snippet} ${publisher}`)
    if (!matches.length) continue
    const previous = unique.get(card.url)
    if (previous) {
      previous.matchedKeywords = [
        ...new Set([...previous.matchedKeywords, ...matches]),
      ]
      continue
    }
    unique.set(card.url, {
      title: cardTitle,
      url: card.url,
      publisher: publisher || new URL(card.url).hostname,
      author: null,
      thumbnailUrl: card.image,
      publishedAt: exactDate(card.date),
      matchedKeywords: matches,
      searchText: clean(`${cardTitle} ${snippet} ${publisher}`, 3000),
    })
    if (unique.size >= 20) break
  }
  return [...unique.values()]
}

async function enrichNaverPost(
  item: MediaCandidate,
  timeout: number,
): Promise<void> {
  const url = new URL(item.url)
  if (
    url.hostname !== 'blog.naver.com' ||
    !/^\/[A-Za-z0-9_.-]+\/\d+$/.test(url.pathname)
  )
    return
  try {
    const response = await fetch(`https://m.blog.naver.com${url.pathname}`, {
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'ko-KR',
        Accept: 'text/html',
      },
    })
    if (!response.ok) return
    const metadata = new Map<string, string>()
    let timestamp: string | null = null
    let blogName = ''
    const parser = new HTMLRewriter()
      .on('meta', {
        element(element) {
          const key =
            element.getAttribute('property') ?? element.getAttribute('name')
          const content = element.getAttribute('content')
          if (key && content && key.startsWith('og:'))
            metadata.set(key, content.slice(0, 4000))
        },
      })
      .on('#_post_property', {
        element(element) {
          timestamp = element.getAttribute('addDate')
          blogName = element.getAttribute('blogName') ?? ''
        },
      })
    await parser.transform(capped(response, POST_LIMIT)).arrayBuffer()
    const canonical = canonicalPost(metadata.get('og:url') ?? null)
    if (canonical !== item.url) return
    if (!item.thumbnailUrl)
      item.thumbnailUrl = imageUrl(metadata.get('og:image') ?? null)
    if (blogName) item.publisher = clean(blogName, 200)
    const author = clean(
      (metadata.get('og:article:author') ?? '').replace(
        /\s*\|\s*블로그\s*$/,
        '',
      ),
      200,
    )
    if (author && !/\.\.|…/.test(author)) item.author = author
    if (!item.publishedAt && timestamp && /^\d{13}$/.test(timestamp)) {
      const value = Number(timestamp)
      if (value >= Date.UTC(2000, 0, 1) && value <= Date.now() + 86400000)
        item.publishedAt = new Date(value).toISOString()
    }
  } catch {
    /* Search-card metadata remains usable when a public post is unavailable. */
  }
}

/** One configured keyword per bounded public search; no key, login or paid API. */
export async function searchBlogs(keyword: string): Promise<MediaCandidate[]> {
  if (!(COMPANY_MEDIA_KEYWORDS as readonly string[]).includes(keyword))
    throw new Error('blog_keyword_not_allowed')
  const started = Date.now()
  const search = new URL('https://search.naver.com/search.naver')
  search.search = new URLSearchParams({
    ssc: 'tab.blog.all',
    query: `"${keyword}"`,
    sm: 'tab_opt',
    nso: 'so:dd,p:all',
  }).toString()
  const response = await fetch(search, {
    signal: AbortSignal.timeout(8000),
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept-Language': 'ko-KR',
      Accept: 'text/html',
    },
  })
  if (!response.ok) throw new Error('blog_source_unavailable')
  const items = await parseBlogSearch(response)
  const remaining = 9500 - (Date.now() - started)
  if (remaining >= 500)
    await Promise.all(
      items
        .filter(
          (item) => !item.publishedAt || !item.thumbnailUrl || !item.publisher,
        )
        .slice(0, 2)
        .map((item) => enrichNaverPost(item, Math.min(2500, remaining))),
    )
  return items
}
