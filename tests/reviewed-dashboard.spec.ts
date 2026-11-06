import { test, expect, type Page } from '@playwright/test'
import {
  REVIEWED_METRIC_KEYS,
  type ReviewedAd,
  type ReviewedMetrics,
  type ReviewedPerformanceData,
  type ReviewedSnapshot,
} from '../src/lib/reviewed-performance-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })

const firstWeek = '2026-11-01|2026-11-07'
const secondWeek = '2026-11-08|2026-11-14'
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
async function mockData(page: Page, value = data()) {
  await mockConnection(page)
  await page.route('**/media/posts/synthetic-ad.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
  await page.route('**/api/performance', (route) =>
    route.fulfill({ json: value }),
  )
}

test('전달된 누적 수치를 원문 지표와 게시물 링크로 기존 성과 대시보드에 표시한다', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockData(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '인스타그램 광고 성과.' }),
  ).toBeVisible()
  await expect(page.locator('.reviewed-dashboard')).toBeVisible()
  await expect(page.locator('.metric-card').first()).toContainText('1,200')
  await expect(
    page.getByRole('heading', { name: '한 줄 결과', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.reviewed-ad-period')).toContainText(
    '집계 날짜 확인 중',
  )
  const thumbnail = page.locator('.reviewed-ad-heading img')
  await expect(thumbnail).toHaveAttribute('src', ad.thumbnailUrl!)
  await expect(thumbnail).toBeVisible()
  expect((await thumbnail.boundingBox())!.width).toBeGreaterThanOrEqual(96)
  await expect(page.getByText('캡처 당시 활성', { exact: true })).toHaveCount(0)
  await expect(page.getByText('캡처 확인 자료', { exact: true })).toHaveCount(0)
  await expect(
    page.getByText('전달받은 캡처의 수치를 보고 있습니다', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '보고 문장 복사' }),
  ).toHaveCount(0)
  const values = page.locator('.reviewed-ad-values')
  await expect(
    values.getByText('Instagram 프로필 방문', { exact: true }),
  ).toBeVisible()
  await expect(values.getByText('조회한 사람', { exact: true })).toBeVisible()
  await expect(
    values.getByText('조회한 사람', { exact: true }).locator('..'),
  ).toContainText('90명')
  await expect(
    values.getByText('링크 클릭', { exact: true }).locator('..'),
  ).toContainText('0회')
  await expect(
    values.locator('dt').filter({ hasText: /^(노출|도달)$/ }),
  ).toHaveCount(0)
  const link = page.getByRole('link', { name: 'Instagram 게시물 보기' })
  await expect(link).toHaveAttribute('href', ad.postUrl)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(page.locator('.reviewed-awaiting')).toContainText(
    '두 번째 광고 자료 대기',
  )
  await expect(page.locator('.reviewed-awaiting')).not.toContainText('0원')
  await expect(page.locator('.reviewed-awaiting')).not.toContainText('0회')
  await expect(
    page.getByRole('link', { name: '인사이트 기록', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await expect(page.getByText('Instagram 연결됨 · 광고 권한 대기')).toHaveCount(
    0,
  )
  expect(errors).toEqual([])
})

test('전체 기간 누적 자료를 날짜가 겹치는 첫 주 실적으로 옮겨 넣지 않는다', async ({
  page,
}) => {
  await mockData(page)
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: /^조회 기간/ })).toHaveValue(
    'latest',
  )
  await page
    .getByRole('combobox', { name: /^조회 기간/ })
    .selectOption(firstWeek)
  await expect(page.locator('.metric-card').first()).toContainText('—')
  await expect(page.locator('.metric-card').first()).not.toContainText('1,200')
  await expect(page.locator('.reviewed-report-text')).toContainText(
    '선택한 기간의 성과 자료를 기다리고 있습니다.',
  )
  await expect(page.locator('.reviewed-ad-empty')).toContainText(
    '선택한 기간의 성과 자료가 없습니다',
  )
  await expect(
    page.getByRole('button', { name: '보고 문장 복사' }),
  ).toHaveCount(0)
  await page.getByLabel('조회 월').fill('2026-10')
  await expect(page.getByRole('combobox', { name: /^조회 기간/ })).toHaveValue(
    '2026-10-01|2026-10-07',
  )
  await page.getByLabel('조회 월').fill('2026-11')
  await expect(page.getByRole('combobox', { name: /^조회 기간/ })).toHaveValue(
    firstWeek,
  )
  await page
    .getByRole('combobox', { name: /^조회 기간/ })
    .selectOption('latest')
  await expect(page.locator('.metric-card').first()).toContainText('1,200')
})

test('두 광고의 서로 다른 집계 기간과 링크 클릭·랜딩 조회·총예산을 구분한다', async ({
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
  await page.goto('/')
  const second = page
    .locator('.reviewed-ad')
    .filter({
      has: page.getByRole('heading', { name: secondAd.title, exact: true }),
    })
  await expect(second).toBeVisible()
  await expect(
    second.getByText('링크 클릭', { exact: true }).locator('..'),
  ).toContainText('30회')
  await expect(
    second.getByText('링크 클릭당 비용', { exact: true }).locator('..'),
  ).toContainText('60원')
  await expect(
    second.getByText('랜딩 페이지 조회', { exact: true }).locator('..'),
  ).toContainText('20회')
  await expect(second.getByText('웹사이트 방문', { exact: true })).toHaveCount(
    0,
  )
  await expect(page.locator('.metric-card').first()).not.toContainText('3,000')
  await second.getByText('광고 설정', { exact: false }).click()
  await expect(second).toContainText('총 예산')
  await expect(second).toContainText('3,000원')
  await expect(second.getByText('일일 예산', { exact: true })).toHaveCount(0)
})

test('확인된 두 주를 다시 선택할 수 있고 같은 기간 수정본은 최신 한 건만 사용한다', async ({
  page,
}) => {
  const weeks = data([
    snapshot(),
    snapshot({
      id: 'first-week-old',
      scope: 'selected_period',
      period: { start: '2026-11-01', end: '2026-11-07' },
      reviewedAt: '2026-11-08T00:00:00Z',
      metrics: metrics({ spend: 400 }),
    }),
    snapshot({
      id: 'first-week-corrected',
      scope: 'selected_period',
      period: { start: '2026-11-01', end: '2026-11-07' },
      reviewedAt: '2026-11-09T00:00:00Z',
      metrics: metrics({ spend: 1100 }),
    }),
    snapshot({
      id: 'second-week',
      scope: 'selected_period',
      period: { start: '2026-11-08', end: '2026-11-14' },
      reviewedAt: '2026-11-15T00:00:00Z',
      metrics: metrics({ spend: 2200 }),
    }),
  ])
  await mockData(page, weeks)
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: /^조회 기간/ })).toHaveValue(
    secondWeek,
  )
  await expect(page.locator('.metric-card').first()).toContainText('2,200')
  await page
    .getByRole('combobox', { name: /^조회 기간/ })
    .selectOption(firstWeek)
  await expect(page.locator('.metric-card').first()).toContainText('1,100')
  await expect(page.locator('.metric-card').first()).not.toContainText('1,500')
  await expect(page.locator('.reviewed-ad-period')).toContainText(
    '2026.11.01 — 2026.11.07',
  )
  await page
    .getByRole('combobox', { name: /^조회 기간/ })
    .selectOption(secondWeek)
  await expect(page.locator('.metric-card').first()).toContainText('2,200')
  await page.reload()
  await expect(page.getByRole('combobox', { name: /^조회 기간/ })).toHaveValue(
    secondWeek,
  )
  await page
    .getByRole('combobox', { name: /^조회 기간/ })
    .selectOption(firstWeek)
  await expect(page.locator('.metric-card').first()).toContainText('1,100')
  const row = page
    .locator('.reviewed-history-table tbody tr')
    .filter({ hasText: '2026.11.01 — 2026.11.07' })
  await expect(row).toContainText('1,100원')
  await expect(row).not.toContainText('1,500원')
})

test('자료 조회 실패는 연결 성공이나 실제 0원으로 표시하지 않고 재시도할 수 있다', async ({
  page,
}) => {
  await mockConnection(page)
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
  await expect(page.locator('.metric-card').first()).toContainText('1,200')
  expect(attempts).toBeGreaterThanOrEqual(2)
})

for (const width of [375, 768, 1440]) {
  test(`캡처 확인 성과와 주간 선택이 ${width}px에서 넘치지 않는다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    await mockData(page)
    await page.goto('/')
    await expect(page.locator('.reviewed-dashboard')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page
      .getByRole('combobox', { name: /^조회 기간/ })
      .selectOption(firstWeek)
    await expect(page.locator('.metric-card').first()).toContainText('—')
    await page
      .getByRole('combobox', { name: /^조회 기간/ })
      .selectOption('latest')
    await expect(page.locator('.metric-card').first()).toContainText('1,200')
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
