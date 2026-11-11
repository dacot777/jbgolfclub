import { test, expect, type Page } from '@playwright/test'
import {
  REVIEWED_METRIC_KEYS,
  type ReviewedAd,
  type ReviewedMetrics,
  type ReviewedPerformanceData,
  type ReviewedSnapshot,
} from '../src/lib/reviewed-performance-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })

const ad: ReviewedAd = {
  id: 'synthetic-post-a',
  title: '검증용 입상 사진 광고',
  postUrl: 'https://www.instagram.com/p/TestPostABCDEFG/',
  thumbnailUrl: '/media/posts/synthetic-ad.png',
  objective: '프로필 방문 수 늘리기',
  status: 'active',
  schedule: {
    start: '2026-11-01',
    end: '2026-11-30',
    dailyBudget: 100,
    durationDays: 30,
  },
}
function metrics(overrides: Partial<ReviewedMetrics> = {}): ReviewedMetrics {
  return {
    ...Object.fromEntries(REVIEWED_METRIC_KEYS.map((key) => [key, null])),
    spend: 1200,
    profileVisits: 10,
    profileVisitCost: 120,
    views: 150,
    viewers: 90,
    postEngagements: 12,
    linkClicks: 0,
    likes: 3,
    video3s: 4,
    ...overrides,
  } as ReviewedMetrics
}
function snapshot(overrides: Partial<ReviewedSnapshot> = {}): ReviewedSnapshot {
  return {
    id: 'synthetic-lifetime',
    adId: ad.id,
    period: null,
    scope: 'lifetime',
    reportedDays: 7,
    metrics: metrics(),
    reviewedAt: '2026-11-06T01:00:00Z',
    sourceLabel: '브라우저 검사 합성 캡처',
    notes: '실제 회사 실적이 아닌 테스트 자료',
    ...overrides,
  }
}
function data(
  snapshots: ReviewedSnapshot[] = [snapshot()],
): ReviewedPerformanceData {
  return {
    version: 1,
    source: 'reviewed_screenshots',
    expectedAdCount: 2,
    updatedAt: '2026-11-15T01:00:00Z',
    ads: [ad],
    snapshots,
  }
}
async function mockConnection(page: Page) {
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
}
async function mockThumbnail(page: Page, path: string) {
  await page.route('**' + path, (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
}
async function mockData(page: Page, value = data()) {
  await mockConnection(page)
  await page.route('**/api/meta-ads/lifetime', (route) =>
    route.fulfill({
      json: { status: 'unconfigured', asOf: null, currency: null, totals: [] },
    }),
  )
  await page.route('**/api/meta-ads', (route) =>
    route.fulfill({
      json: {
        status: 'unconfigured',
        lastSyncedAt: null,
        currency: null,
        timeZone: null,
        adPeriods: [],
        periods: [],
        daily: [],
      },
    }),
  )
  await mockThumbnail(page, '/media/posts/synthetic-ad.png')
  await page.route('**/api/performance', (route) =>
    route.fulfill({ json: value }),
  )
}
function adValues(page: Page, title = ad.title) {
  return page
    .locator('.reviewed-ad')
    .filter({
      has: page.getByRole('heading', { name: title, exact: true }),
    })
    .locator('.reviewed-ad-values')
}

function periodMode(page: Page, name: '전체 누적' | '주간' | '월간') {
  return page
    .getByRole('group', { name: '조회 기간', exact: true })
    .getByRole('button', { name, exact: true })
}

async function chooseRange(page: Page, mode: '주간' | '월간', label: string) {
  const button = periodMode(page, mode)
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  const range = page
    .getByRole('group', {
      name: mode === '주간' ? '조회할 주' : '조회할 달',
      exact: true,
    })
    .getByRole('button', { name: label, exact: true })
  await range.click()
  await expect(range).toHaveAttribute('aria-pressed', 'true')
}

const newCatalogAd = {
  id: 'ad-synthetic-inventory-a',
  title: '합성 여름 레슨 광고',
  postUrl: 'https://www.instagram.com/p/SyntheticNewPost/',
  thumbnailUrl: '/api/meta-ads/thumbnail/ad-synthetic-inventory-a',
  status: 'active',
  startAt: '2026-10-14T01:00:00Z',
  firstDeliveryDate: '2026-10-18',
} as const

function total(reviewedAdId: string, spend: number) {
  return {
    reviewedAdId,
    spend,
    impressions: 951,
    linkClicks: 31,
    reach: 402,
    since: '2026-10-16',
    until: '2026-11-18',
    complete: true,
  }
}

async function mockLifetime(
  page: Page,
  getTotals: () => ReturnType<typeof total>[],
) {
  let asOf = Date.parse('2026-11-18T00:14:00Z')
  await page.route('**/api/meta-ads/lifetime', (route) => {
    expect(route.request().method()).toBe('GET')
    asOf += 60000
    return route.fulfill({
      json: {
        status: 'ready',
        asOf: new Date(asOf).toISOString(),
        currency: 'KRW',
        totals: getTotals(),
      },
    })
  })
}

async function mockInventory(page: Page, includeReviewed: boolean) {
  const reviewed = data(includeReviewed ? [snapshot()] : [])
  if (!includeReviewed) reviewed.ads = []
  await mockData(page, reviewed)
  const futureAd = {
    id: 'ad-synthetic-inventory-b',
    title: '합성 다음 시즌 광고',
    postUrl: null,
    thumbnailUrl: null,
    status: 'scheduled',
  }
  const existing = {
    id: ad.id,
    title: '합성 Meta 광고 이름',
    postUrl: ad.postUrl,
    thumbnailUrl: null,
    status: 'paused',
    firstDeliveryDate: '2026-10-17',
    pauseEvents: [
      {
        at: '2026-11-11T02:00:00Z',
        previousActiveAt: '2026-11-11T01:00:00Z',
        source: 'observed',
        lastDeliveryDate: '2026-11-10',
      },
      {
        at: '2026-11-12T06:30:00Z',
        source: 'meta',
        lastDeliveryDate: '2026-11-12',
      },
    ],
  }
  const current = {
    reviewedAdId: newCatalogAd.id,
    kind: 'week',
    since: '2026-11-16',
    until: '2026-11-18',
    spend: 8432,
    impressions: 350,
    reach: 130,
    linkClicks: 12,
  }
  const past = {
    ...current,
    reviewedAdId: ad.id,
    since: '2026-11-09',
    until: '2026-11-15',
    spend: 3786,
  }
  await page.route('**/api/meta-ads', (route) =>
    route.fulfill({
      json: {
        status: 'ready',
        lastSyncedAt: '2026-11-18T00:15:00Z',
        currency: 'KRW',
        timeZone: 'Asia/Seoul',
        cards: [newCatalogAd, includeReviewed ? existing : futureAd],
        adPeriods: includeReviewed ? [current, past] : [current],
        periods: [],
        daily: [],
      },
    }),
  )
  await mockLifetime(page, () =>
    includeReviewed
      ? [total(newCatalogAd.id, 13541), total(ad.id, 7465)]
      : [total(newCatalogAd.id, 13541)],
  )
  await mockThumbnail(page, newCatalogAd.thumbnailUrl)
}

test('기존 캡처가 없어도 발견된 광고의 사진과 실적을 표시하고 집행 예정 광고에 0을 넣지 않는다', async ({
  page,
}) => {
  await mockInventory(page, false)
  await page.setViewportSize({ width: 320, height: 870 })
  await page.goto('/')
  const cards = page.locator('#campaigns .reviewed-ad')
  const active = cards.filter({
    has: page.getByRole('heading', { name: newCatalogAd.title, exact: true }),
  })
  const scheduled = cards.filter({
    has: page.getByRole('heading', {
      name: '합성 다음 시즌 광고',
      exact: true,
    }),
  })
  await expect(cards).toHaveCount(2)
  await expect(active.getByText('집행 중', { exact: true })).toBeVisible()
  await expect(active).toContainText('13,541원')
  await expect(active).toContainText('광고 시작 일시')
  await expect(active).toContainText(/2026\.\s*10\.\s*14/)
  const image = active.getByRole('img')
  await expect(image).toHaveAttribute('src', newCatalogAd.thumbnailUrl)
  await image.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(
    active.getByRole('link', { name: 'Instagram 게시물 보기' }),
  ).toHaveAttribute('href', newCatalogAd.postUrl)
  await expect(scheduled.getByText('집행 예정', { exact: true })).toBeVisible()
  await expect(scheduled.getByText(/^0(?:원|회|명)$/)).toHaveCount(0)
  await expect(scheduled.getByRole('link')).toHaveCount(0)
  await expect(
    page.locator('h2').filter({ hasText: '광고 자동 보고서' }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('기존 게시물 카드에 일시중단 상태와 날짜가 표시된 이전 실적을 유지한다', async ({
  page,
}) => {
  await mockInventory(page, true)
  await page.setViewportSize({ width: 375, height: 870 })
  await page.goto('/')
  const cards = page.locator('#campaigns .reviewed-ad')
  const paused = cards.filter({
    has: page.getByRole('heading', { name: ad.title, exact: true }),
  })
  const active = cards.filter({
    has: page.getByRole('heading', { name: newCatalogAd.title, exact: true }),
  })
  const lifetime = periodMode(page, '전체 누적')
  await expect(cards).toHaveCount(2)
  await expect(paused.locator('.ad-delivery-status')).toHaveText('일시중단')
  await expect(paused).toContainText('첫 집행 확인일')
  await expect(paused).toContainText(/2026\.\s*10\.\s*17/)
  await expect(lifetime).toHaveAttribute('aria-pressed', 'true')
  await expect(active).toContainText('13,541원')
  await expect(paused).toContainText('7,465원')
  await chooseRange(page, '주간', '주간 · 2026.11.16 — 2026.11.18')
  await expect(active).toContainText('8,432원')
  await expect(paused).toContainText('3,786원')
  await expect(paused).toContainText('마지막 Meta 실적')
  await expect(paused).toContainText('2026.11.09')
  await expect(paused).toContainText('2026.11.15')
  await expect(paused).not.toContainText('8,432원')
  await chooseRange(page, '주간', '주간 · 2026.11.09 — 2026.11.15')
  await expect(paused).toContainText('3,786원')
  const observed = paused
    .getByText('중단 확인 (추정 구간)', { exact: true })
    .locator('..')
  await expect(observed).toContainText(/2026\.\s*11\.\s*11/)
  await expect(observed).toContainText('10:00')
  await expect(observed).toContainText('11:00')
  await expect(observed).toContainText(
    /마지막 집행 확인일\s*2026\.\s*11\.\s*10/,
  )
  const recorded = paused
    .getByText('일시중단 시각', { exact: true })
    .locator('..')
  await expect(recorded).toContainText(/2026\.\s*11\.\s*12/)
  await expect(recorded).toContainText('15:30')
  await expect(active).not.toContainText('3,786원')
  await lifetime.click()
  await expect(paused).toContainText('7,465원')
  await expect(paused.locator('.ad-delivery-status')).toHaveText('일시중단')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('두 게시물의 Meta 전체 누적이 열린 화면에서 갱신되고 과거 주간·월간 실적은 기간별로 남는다', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-18T01:00:00Z') })
  const secondAd: ReviewedAd = {
    ...ad,
    id: 'synthetic-post-b',
    title: '검증용 두 번째 광고',
    postUrl: 'https://www.instagram.com/p/TestPostHIJKLMN/',
  }
  const value = data([
    snapshot(),
    snapshot({
      id: 'second-lifetime',
      adId: secondAd.id,
      metrics: metrics({ spend: 1800 }),
    }),
    snapshot({
      id: 'old-manual-week',
      scope: 'selected_period',
      period: { start: '2026-11-16', end: '2026-11-18' },
      metrics: metrics({ spend: 13997 }),
      commentary: '이전 캡처 수기 코멘트',
    }),
    snapshot({
      id: 'unmatched-manual-week',
      scope: 'selected_period',
      period: { start: '2026-11-02', end: '2026-11-08' },
    }),
  ])
  value.ads.push(secondAd)
  await mockData(page, value)
  let firstSpend = 15403
  await mockLifetime(page, () => [
    total(ad.id, firstSpend),
    { ...total(secondAd.id, 8854), complete: false, since: '2026-10-21' },
  ])
  const week = {
    kind: 'week',
    since: '2026-11-16',
    until: '2026-11-18',
    impressions: 520,
    reach: 95,
  }
  const month = { ...week, kind: 'month', since: '2026-11-01' }
  const day = {
    date: '2026-11-17',
    adName: '동일한 광고 이름',
    impressions: 20,
    reach: 15,
  }
  let reads = 0
  await page.route('**/api/meta-ads', (route) => {
    expect(route.request().method()).toBe('GET')
    reads++
    return route.fulfill({
      json: {
        status: 'error',
        lastSyncedAt: '2026-11-18T00:15:00Z',
        currency: 'KRW',
        timeZone: 'Asia/Seoul',
        periods: [{ ...week, spend: 99999, linkClicks: 320 }],
        adPeriods: [
          { ...week, reviewedAdId: secondAd.id, spend: 4567, linkClicks: null },
          { ...week, reviewedAdId: ad.id, spend: 2345, linkClicks: 0 },
          { ...month, reviewedAdId: ad.id, spend: 9786, linkClicks: 18 },
        ],
        daily: [
          { ...day, reviewedAdId: ad.id, spend: 223, linkClicks: 1 },
          { ...day, reviewedAdId: ad.id, spend: 200, linkClicks: 1 },
          { ...day, reviewedAdId: secondAd.id, spend: 671, linkClicks: 4 },
          { ...day, adName: ad.title, spend: 34567, linkClicks: 99 },
        ],
      },
    })
  })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/')
  const card = (title: string) =>
    page.locator('.reviewed-ad').filter({
      has: page.getByRole('heading', { name: title, exact: true }),
    })
  const first = card(ad.title)
  const second = card(secondAd.title)
  const lifetime = periodMode(page, '전체 누적')
  await expect(lifetime).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.reviewed-dashboard select')).toHaveCount(0)
  await expect(first).toContainText('15,403원')
  await expect(second).toContainText('8,854원')
  await expect(second).toContainText('Meta 제공 기간')
  await expect(second).toContainText(/2026\.\s*10\.\s*21/)
  await expect(second).toContainText(/2026\.\s*11\.\s*18/)
  await expect(first).not.toContainText('1,200원')
  firstSpend = 16208
  await page.clock.fastForward('01:01')
  await expect(first).toContainText('16,208원')
  await expect(second).toContainText('8,854원')
  await expect(
    page.getByRole('button', { name: /일일|2026\.11\.17/ }),
  ).toHaveCount(0)
  await chooseRange(page, '주간', '주간 · 2026.11.16 — 2026.11.18')
  await expect(first).toContainText('2,345')
  await expect(second).toContainText('4,567')
  await expect(page.getByRole('button', { name: /2026\.11\.02/ })).toHaveCount(
    0,
  )
  await expect(page.locator('.reviewed-dashboard')).not.toContainText(
    /13,997원|이전 캡처 수기 코멘트/,
  )
  await expect(first).not.toContainText('4,567')
  await expect(second).not.toContainText('2,345')
  await expect(
    first.getByText('링크 클릭', { exact: true }).locator('..'),
  ).toContainText('0회')
  await expect(
    second
      .getByText('링크 클릭', { exact: true })
      .locator('..')
      .filter({ hasText: '0회' }),
  ).toHaveCount(0)
  await expect(page.getByText(/99,999/)).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: '광고 자동 보고서', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByLabel('관리자 비밀번호')).toHaveCount(0)
  expect(reads).toBeGreaterThan(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)

  await chooseRange(page, '월간', '월간 · 2026.11.01 — 2026.11.18')
  await expect(first).toContainText('9,786')
  await expect(second).not.toContainText(/9,786|4,567|1,800/)
  await expect(page.getByText(/34,567/)).toHaveCount(0)
  await lifetime.click()
  await expect(first).toContainText('16,208원')
  await expect(second).toContainText('8,854원')
  await expect(first).not.toContainText(/2,345|9,786/)
})

test('기존 광고 보고서 링크는 로그인 없이 기존 광고별 상세 실적으로 이동한다', async ({
  page,
}) => {
  await mockData(page)
  let showCards!: () => void
  const cardsReady = new Promise<void>((resolve) => {
    showCards = resolve
  })
  await page.route('**/api/performance', async (route) => {
    await cardsReady
    await route.fulfill({ json: data() })
  })
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto('/#ad-report', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#campaigns$/)
  showCards()
  const target = page.locator('#campaigns')
  await expect(
    target.getByRole('heading', { name: '광고별 상세 실적', exact: true }),
  ).toBeInViewport()
  await expect(
    target.getByRole('heading', { name: ad.title, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '광고 자동 보고서', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByLabel('관리자 비밀번호')).toHaveCount(0)
  await page
    .getByRole('link', { name: 'JB GOLF ACADEMY 대시보드', exact: true })
    .click()
  await page.getByRole('button', { name: '계정 연결', exact: true }).click()
  await page
    .getByRole('dialog')
    .locator('a[href="#ad-report"], a[href="#campaigns"]')
    .click()
  await expect(page).toHaveURL(/#campaigns$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    target.getByRole('heading', { name: '광고별 상세 실적', exact: true }),
  ).toBeInViewport()
})

test('Meta 실적이 없어도 기존 게시물 사진과 링크를 유지하고 수기 실적은 숨긴다', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const archivedComment = '이전 검토 기록에만 있던 가상 코멘트'
  await mockData(
    page,
    data([
      snapshot(),
      snapshot({
        id: 'archived-week',
        period: { start: '2026-11-01', end: '2026-11-07' },
        scope: 'selected_period',
        metrics: metrics({ spend: 2351 }),
        commentary: archivedComment,
      }),
    ]),
  )
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '인스타그램 광고 성과.' }),
  ).toBeVisible()
  await expect(periodMode(page, '전체 누적')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(periodMode(page, '주간')).toBeDisabled()
  await expect(periodMode(page, '월간')).toBeDisabled()
  const dash = page.locator('.reviewed-dashboard')
  await expect(dash).not.toContainText(
    /저장된 실적|저장된 누적 기록|저장된 기간별 성과|1,200원|2,351원/,
  )
  await expect(dash).not.toContainText(archivedComment)
  await expect(dash.getByRole('table')).toHaveCount(0)
  await expect(
    dash.locator('select, input[type=month], input[type=file]'),
  ).toHaveCount(0)
  await expect(
    dash.getByRole('button', { name: /2026\.11\.0[17]/ }),
  ).toHaveCount(0)
  await expect(
    dash.locator('.metric-grid, .reviewed-history, .reviewed-awaiting'),
  ).toHaveCount(0)
  await expect(
    dash.getByRole('button', { name: '보고 문장 복사' }),
  ).toHaveCount(0)
  await expect(
    dash.getByRole('heading', { name: '한 줄 결과', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: '주간업무보고', exact: true }),
  ).toHaveCount(0)
  const thumbnail = dash.locator('.reviewed-ad-heading img')
  await expect(thumbnail).toHaveAttribute('src', ad.thumbnailUrl!)
  await expect(thumbnail).toBeVisible()
  expect((await thumbnail.boundingBox())!.width).toBeGreaterThanOrEqual(96)
  const link = dash.getByRole('link', { name: 'Instagram 게시물 보기' })
  await expect(link).toHaveAttribute('href', ad.postUrl)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)
  expect(errors).toEqual([])
})

test('실제 Meta 지출과 링크 클릭을 표시하고 캡처 지표 및 광고 설정 예산과 구분한다', async ({
  page,
}) => {
  const secondAd: ReviewedAd = {
    ...ad,
    id: 'synthetic-post-b',
    title: '검증용 시설 광고',
    objective: '링크 클릭 수 늘리기',
    postUrl: 'https://www.instagram.com/p/TestPostHIJKLMN/',
    schedule: {
      start: '2026-11-01',
      end: '2026-12-01',
      dailyBudget: null,
      totalBudget: 3000,
      durationDays: 30,
    },
    targeting: {
      locations: ['검증 도시'],
      ageMin: 21,
      ageMax: 44,
      interests: ['검증 관심사'],
      locationOptimization: false,
      advantageDetailedTargeting: true,
      advantageAudience: false,
    },
  }
  const value = data([
    snapshot(),
    snapshot({
      id: 'synthetic-second-lifetime',
      adId: secondAd.id,
      reportedDays: 8,
      metrics: metrics({
        spend: 1800,
        profileVisits: null,
        profileVisitCost: null,
        websiteVisits: null,
        websiteVisitCost: null,
        linkClicks: 30,
        linkClickCost: 60,
        landingPageViews: 20,
      }),
    }),
  ])
  value.ads.push(secondAd)
  await mockData(page, value)
  await mockLifetime(page, () => [
    total(ad.id, 731),
    { ...total(secondAd.id, 2576), linkClicks: 17 },
  ])
  await page.goto('/')
  const second = page.locator('.reviewed-ad').filter({
    has: page.getByRole('heading', { name: secondAd.title, exact: true }),
  })
  await expect(second).toBeVisible()
  await expect(
    second.getByText('링크 클릭', { exact: true }).locator('..'),
  ).toContainText('17회')
  await expect(
    second.getByText('링크 클릭당 비용', { exact: true }).locator('..'),
  ).toContainText('152원')
  await expect(
    second.getByText('랜딩 페이지 조회', { exact: true }),
  ).toHaveCount(0)
  await expect(second.getByText('웹사이트 방문', { exact: true })).toHaveCount(
    0,
  )
  await expect(page.locator('.reviewed-dashboard .metric-grid')).toHaveCount(0)
  await expect(adValues(page)).toContainText('731원')
  await expect(adValues(page, secondAd.title)).toContainText('2,576원')
  expect(
    (await page.locator('.reviewed-ad-values').allTextContents()).join('\n'),
  ).not.toContain('3,000원')
  await second.getByText('광고 설정', { exact: false }).click()
  await expect(second).toContainText('총 예산')
  await expect(second).toContainText('3,000원')
  await expect(second.getByText('일일 예산', { exact: true })).toHaveCount(0)
  await second.getByText('광고 타겟', { exact: true }).click()
  await expect(second).toContainText('검증 도시')
})

test('자료 조회 실패는 연결 성공이나 실제 0원으로 표시하지 않고 재시도할 수 있다', async ({
  page,
}) => {
  await mockConnection(page)
  await mockLifetime(page, () => [total(ad.id, 1629)])
  let attempts = 0
  let failing = true
  await page.route('**/api/performance', (route) => {
    attempts += 1
    return failing
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'performance_unavailable' } },
        })
      : route.fulfill({ json: data() })
  })
  await page.goto('/')
  await expect(
    page.getByText(
      '확인된 광고 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    ),
  ).toBeVisible()
  await expect(page.getByText('Instagram 연결됨 · 광고 권한 대기')).toHaveCount(
    0,
  )
  await expect(page.locator('.metric-card').first()).toContainText('—')
  failing = false
  await page.getByRole('button', { name: '자료 다시 불러오기' }).click()
  await expect(page.locator('.reviewed-dashboard')).toBeVisible()
  await expect(adValues(page)).toContainText('1,629원')
  await expect(page.locator('.reviewed-dashboard')).not.toContainText('1,200원')
  await expect(page.locator('.reviewed-dashboard .metric-grid')).toHaveCount(0)
  expect(attempts).toBeGreaterThanOrEqual(2)
})

for (const width of [375, 768, 1440]) {
  test(`Meta 전체 누적과 주간 조회 버튼이 ${width}px에서 넘치지 않는다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    await mockInventory(page, true)
    await page.goto('/')
    await expect(page.locator('.reviewed-dashboard')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await expect(periodMode(page, '전체 누적')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(periodMode(page, '월간')).toBeDisabled()
    await expect(page.locator('.reviewed-dashboard .metric-grid')).toHaveCount(
      0,
    )
    await chooseRange(page, '주간', '주간 · 2026.11.09 — 2026.11.15')
    await expect(adValues(page)).toContainText('3,786원')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `/tmp/jbgolf-reviewed-${width}.png`,
      fullPage: true,
    })
  })
}
