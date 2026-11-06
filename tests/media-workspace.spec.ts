import { test, expect, type Page } from '@playwright/test'
import {
  COMPANY_MEDIA_KEYWORDS,
  type MediaFeed,
  type MediaItem,
  type MediaKind,
} from '../src/lib/media-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })
const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII='
function item(index: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: `synthetic-media-${index}`,
    title: `JB골프클럽 소식 검증 기사 ${index}`,
    url: `https://example.com/news/${index}`,
    publisher: '검증일보',
    author: null,
    thumbnailUrl: `https://images.example.com/${index}.png`,
    publishedAt: '2026-11-05T09:00:00+09:00',
    firstSeenAt: '2026-11-06T01:00:00Z',
    matchedKeywords: ['JB골프클럽'],
    ...overrides,
  }
}
function feed(kind: MediaKind, overrides: Partial<MediaFeed> = {}): MediaFeed {
  return {
    kind,
    keywords: [...COMPANY_MEDIA_KEYWORDS],
    items: [item(1), item(2), item(3), item(4)],
    updatedAt: '2026-11-06T01:00:00Z',
    checkedAt: '2026-11-06T01:00:00Z',
    status: 'fresh',
    refreshing: false,
    successfulQueries: 9,
    totalQueries: 9,
    ...overrides,
  }
}
async function baseMocks(page: Page) {
  await page.route('**/api/connection', (route) =>
    route.fulfill({
      json: {
        configured: false,
        authenticated: false,
        advertisingAccess: false,
        connection: null,
      },
    }),
  )
  await page.route('**/api/performance', (route) =>
    route.fulfill({
      json: {
        version: 1,
        source: 'reviewed_screenshots',
        expectedAdCount: 2,
        updatedAt: null,
        ads: [],
        snapshots: [],
      },
    }),
  )
  await page.route('https://images.example.com/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(image, 'base64'),
    }),
  )
}

test('기사에 들어가면 자동 조회하고 언론사·키워드·사진을 데스크톱3열로 표시한다', async ({
  page,
}) => {
  const requests: string[] = []
  await baseMocks(page)
  await page.route('**/api/media?kind=*', (route) => {
    requests.push(route.request().url())
    return route.fulfill({ json: feed('news') })
  })
  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto('/#news')
  await expect(
    page.getByRole('heading', { name: '기사.', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.media-card')).toHaveCount(4)
  expect(requests.length).toBe(1)
  await expect(
    page.getByRole('list', { name: '모니터링 키워드' }).locator('li'),
  ).toHaveCount(9)
  await expect(page.locator('.media-publisher').first()).toContainText(
    '검증일보',
  )
  await expect(
    page.locator('.media-card').first().getByRole('link'),
  ).toHaveAttribute('href', 'https://example.com/news/1')
  await expect(
    page.locator('.media-card').first().getByRole('link'),
  ).toHaveAttribute('target', '_blank')
  await expect(page.locator('.media-card img')).toHaveCount(4)
  await expect(
    page.getByRole('button', {
      name: /갱신|새로고침|업데이트|검색|더 보기|다시 시도/,
    }),
  ).toHaveCount(0)
  const cards = await page.locator('.media-card').evaluateAll((els) =>
    els.map((el) => ({
      x: el.getBoundingClientRect().x,
      y: el.getBoundingClientRect().y,
    })),
  )
  expect(cards[0].y).toBe(cards[1].y)
  expect(cards[1].y).toBe(cards[2].y)
  expect(cards[3].y).toBeGreaterThan(cards[0].y)
  await page.screenshot({
    path: '/tmp/jbgolf-media-news-1440.png',
    fullPage: true,
  })
})

test('개인 후기 블로그와 작성자를 표시하고 메뉴 재진입 때 다시 조회한다', async ({
  page,
}) => {
  await baseMocks(page)
  const counts = { news: 0, blog: 0 }
  await page.route('**/api/media?kind=*', (route) => {
    const kind = new URL(route.request().url()).searchParams.get(
      'kind',
    ) as MediaKind
    counts[kind] += 1
    return route.fulfill({
      json:
        kind === 'blog'
          ? feed('blog', {
              items: [
                item(10, {
                  title: '직접 다녀온 JB골프클럽 연습 후기',
                  publisher: '네이버 블로그',
                  author: '주말골퍼',
                  url: 'https://blog.naver.com/synthetic-review/100',
                }),
              ],
            })
          : feed('news'),
    })
  })
  await page.goto('/#blog')
  await expect(
    page.getByRole('heading', {
      name: '직접 다녀온 JB골프클럽 연습 후기',
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByText('주말골퍼', { exact: true })).toBeVisible()
  await expect(page.locator('.media-publisher')).toContainText('네이버 블로그')
  expect(counts.blog).toBe(1)
  await page.getByRole('link', { name: '기사', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '기사.', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.media-card')).toHaveCount(4)
  await page.getByRole('link', { name: '블로그', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '블로그.', exact: true }),
  ).toBeVisible()
  await expect.poll(() => counts.blog).toBe(2)
  await expect(page.locator('.media-card')).toHaveCount(1)
  expect(counts.news).toBe(1)
})

test('키워드 확인이 계속되면 기존 글을 보여주면서 별도조작 없이 자동 확인한다', async ({
  page,
}) => {
  await baseMocks(page)
  let calls = 0
  await page.route('**/api/media?kind=*', (route) => {
    calls += 1
    return route.fulfill({
      json: feed(
        'news',
        calls === 1
          ? { items: [item(1)], refreshing: true, successfulQueries: 1 }
          : {
              items: [item(1), item(2)],
              refreshing: false,
              successfulQueries: 9,
            },
      ),
    })
  })
  await page.goto('/#news')
  await expect(page.locator('.media-card')).toHaveCount(1)
  await expect(page.getByText('키워드 확인 중 · 1/9')).toBeVisible()
  await expect(page.locator('.media-card')).toHaveCount(2)
  expect(calls).toBe(2)
  await expect(page.getByText('키워드 확인 중 · 1/9')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /갱신|새로고침|업데이트|다시/ }),
  ).toHaveCount(0)
})

test('실제 게시일과 수집일을 구분하고 이미지 누락·실패는 정직하게 표시한다', async ({
  page,
}) => {
  await baseMocks(page)
  await page.route('https://images.example.com/broken.png', (route) =>
    route.fulfill({ status: 404, body: '' }),
  )
  await page.route('**/api/media?kind=*', (route) =>
    route.fulfill({
      json: feed('news', {
        items: [
          item(1, { publishedAt: null, thumbnailUrl: null }),
          item(2, { thumbnailUrl: 'https://images.example.com/broken.png' }),
        ],
      }),
    }),
  )
  await page.goto('/#news')
  await expect(page.locator('.media-card')).toHaveCount(2)
  await expect(page.locator('.media-card').first()).toContainText(
    '게시일 미확인',
  )
  await expect(page.locator('.media-card').first().locator('time')).toHaveCount(
    0,
  )
  await expect(page.locator('.media-thumbnail-fallback')).toHaveCount(2)
  await expect(page.locator('.media-check-state')).toContainText('최근 확인')
})

test('검색 결과없음과 연결실패를 구분하고 가짜 게시물·갱신버튼을 만들지 않는다', async ({
  page,
}) => {
  await baseMocks(page)
  await page.route('**/api/media?kind=*', (route) => {
    const kind = new URL(route.request().url()).searchParams.get(
      'kind',
    ) as MediaKind
    return route.fulfill({
      json: feed(kind, {
        items: [],
        status: kind === 'news' ? 'fresh' : 'unavailable',
        successfulQueries: kind === 'news' ? 9 : 0,
      }),
    })
  })
  await page.goto('/#news')
  await expect(
    page.getByRole('heading', { name: '아직 관련 기사를 찾지 못했습니다' }),
  ).toBeVisible()
  await expect(page.locator('.media-card')).toHaveCount(0)
  await page.getByRole('link', { name: '블로그', exact: true }).click()
  await expect(
    page.getByRole('heading', {
      name: '블로그 목록을 잠시 불러오지 못했습니다',
    }),
  ).toBeVisible()
  await expect(
    page.getByText('아직 관련 블로그를 찾지 못했습니다'),
  ).toHaveCount(0)
  await expect(page.locator('.media-card')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /갱신|새로고침|업데이트|다시 시도/ }),
  ).toHaveCount(0)
})

for (const width of [320, 375, 768]) {
  test(`미디어 목록 ${width}px에서 넘침 없이 반응형 열로 표시한다`, async ({
    page,
  }) => {
    await baseMocks(page)
    await page.route('**/api/media?kind=*', (route) =>
      route.fulfill({ json: feed('news') }),
    )
    await page.setViewportSize({ width, height: 1040 })
    await page.goto('/#news')
    await expect(page.locator('.media-card')).toHaveCount(4)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    const cards = await page
      .locator('.media-card')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().y))
    if (width <= 375) expect(cards[1]).toBeGreaterThan(cards[0])
    else {
      expect(cards[1]).toBe(cards[0])
      expect(cards[2]).toBeGreaterThan(cards[0])
    }
    await page.screenshot({
      path: `/tmp/jbgolf-media-news-${width}.png`,
      fullPage: true,
    })
  })
}
