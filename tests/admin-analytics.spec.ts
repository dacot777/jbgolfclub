import { test, expect, type Page } from '@playwright/test'
import type { AnalyticsReport } from '../src/lib/analytics-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })
const fakePassword = 'synthetic-admin-test-password'
const fakeCsrf = 'synthetic-admin-csrf'
function report(days: 1 | 7 | 30 = 1, page = 1): AnalyticsReport {
  return {
    days,
    page,
    pageSize: 50,
    totalVisits: 1,
    totalVisitors: 1,
    totalActiveMs: 135000,
    totalPages: 1,
    updatedAt: '2026-11-06T00:03:00Z',
    visits: [
      {
        id: 'synthetic-visit',
        visitorLabel: '방문자 TEST0001',
        startedAt: '2026-11-06T00:00:00Z',
        lastSeenAt: '2026-11-06T00:02:15Z',
        endedAt: null,
        activeMs: 135000,
        browser: 'Chrome',
        device: '데스크톱',
        status: 'idle',
        views: [
          {
            id: 'synthetic-overview',
            menu: 'overview',
            enteredAt: '2026-11-06T00:00:00Z',
            lastSeenAt: '2026-11-06T00:01:30Z',
            endedAt: '2026-11-06T00:01:30Z',
            activeMs: 90000,
            active: false,
          },
          {
            id: 'synthetic-news',
            menu: 'news',
            enteredAt: '2026-11-06T00:01:30Z',
            lastSeenAt: '2026-11-06T00:02:15Z',
            endedAt: null,
            activeMs: 45000,
            active: false,
          },
        ],
      },
    ],
  }
}
async function base(page: Page) {
  await page.route('**/api/performance', (route) =>
    route.fulfill({
      json: {
        version: 1,
        source: 'reviewed_screenshots',
        expectedAdCount: 2,
        ads: [],
        snapshots: [],
        updatedAt: null,
      },
    }),
  )
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
  await page.route('**/api/analytics/event', (route) =>
    route.fulfill({ status: 204 }),
  )
}
async function mockAdmin(
  page: Page,
  options: { authenticated?: boolean; empty?: boolean; pages?: number } = {},
) {
  await base(page)
  let authenticated = options.authenticated ?? false
  let reports = 0
  let logouts = 0
  const queries: string[] = []
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      json: {
        configured: true,
        authenticated,
        ...(authenticated ? { csrfToken: fakeCsrf } : {}),
      },
    }),
  )
  await page.route('**/api/admin/login', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      password: route.request().postDataJSON().password,
    })
    authenticated = route.request().postDataJSON().password === fakePassword
    await route.fulfill(
      authenticated
        ? {
            json: {
              configured: true,
              authenticated: true,
              csrfToken: fakeCsrf,
            },
          }
        : { status: 401, json: { error: { code: 'invalid_credentials' } } },
    )
  })
  await page.route('**/api/admin/analytics?**', async (route) => {
    reports++
    const url = new URL(route.request().url())
    queries.push(url.search)
    if (!authenticated) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'authentication_required' } },
      })
      return
    }
    const data = report(
      Number(url.searchParams.get('days')) as 1 | 7 | 30,
      Number(url.searchParams.get('page')),
    )
    if (options.empty) {
      data.visits = []
      data.totalVisits = 0
      data.totalVisitors = 0
      data.totalActiveMs = 0
      data.totalPages = 0
    }
    if (options.pages) {
      data.totalPages = options.pages
      data.totalVisits = options.pages * 50
    }
    await route.fulfill({ json: data })
  })
  await page.route('**/api/admin/logout', async (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe(fakeCsrf)
    authenticated = false
    logouts++
    await route.fulfill({ json: { configured: true, authenticated: false } })
  })
  return {
    reports: () => reports,
    logouts: () => logouts,
    queries,
    expire: () => {
      authenticated = false
    },
  }
}

test('공개 대시보드는 게시된 광고가 없어도 관리자 통계를 요청하지 않는다', async ({
  page,
}) => {
  const api = await mockAdmin(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '인스타그램 광고 성과.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '광고 자동 보고서', exact: true }),
  ).toHaveCount(0)
  await expect(page.getByLabel('관리자 비밀번호')).toHaveCount(0)
  expect(api.reports()).toBe(0)
})

for (const width of [1440, 390, 320]) {
  test(`${width}px 로고 위 실제 빈 좌표를 세 번 눌러도 선택·끌기 없이 인증 화면만 열린다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const api = await mockAdmin(page)
    await page.goto('/')
    const entry = page.getByRole('button', {
      name: '관리자 페이지 열기',
      exact: true,
    })
    const shield = page.locator('.academy-brand .academy-shield')
    await expect(entry).toBeVisible()
    await expect(shield).toHaveAttribute('draggable', 'false')
    const entryBox = await entry.boundingBox()
    const shieldBox = await shield.boundingBox()
    const sidebarBox = await page.locator('.sidebar').boundingBox()
    expect(entryBox).not.toBeNull()
    expect(shieldBox).not.toBeNull()
    expect(sidebarBox).not.toBeNull()
    expect(entryBox!.height).toBe(32)
    expect(entryBox!.width).toBe(sidebarBox!.width)
    expect(entryBox!.y + entryBox!.height).toBeLessThanOrEqual(shieldBox!.y)
    const x = shieldBox!.x + shieldBox!.width / 2
    const y = entryBox!.y + entryBox!.height / 2
    expect(x).toBeGreaterThan(entryBox!.x)
    expect(x).toBeLessThan(entryBox!.x + entryBox!.width)
    await page.evaluate(() => {
      document.documentElement.dataset.brandDrags = '0'
      document.addEventListener('dragstart', (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('.academy-brand') &&
          !event.defaultPrevented
        )
          document.documentElement.dataset.brandDrags = String(
            Number(document.documentElement.dataset.brandDrags) + 1,
          )
      })
    })
    // A real pointer drag on the shield must not select or drag the logo.
    await page.mouse.move(x, shieldBox!.y + shieldBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(x + 70, shieldBox!.y + shieldBox!.height + 20, {
      steps: 10,
    })
    await page.mouse.up()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      '',
    )
    await expect(page.locator('html')).toHaveAttribute('data-brand-drags', '0')
    await page.screenshot({
      path: `/tmp/jbgolf-admin-entry-${width}.png`,
    })
    // Click at the blank pixel directly above the actual shield, rather than
    // programmatically dispatching clickCount=3 to an arbitrary DOM node.
    await page.mouse.click(x, y)
    await page.mouse.click(x, y)
    await expect(page).not.toHaveURL(/#admin$/)
    await page.mouse.click(x, y)
    await expect(page).toHaveURL(/#admin$/)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      '',
    )
    await expect(
      page.getByRole('heading', { name: '관리자 로그인', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByLabel('관리자 비밀번호', { exact: true }),
    ).toHaveValue('')
    await expect(
      page.getByLabel('관리자 비밀번호', { exact: true }),
    ).toHaveAttribute('type', 'password')
    await expect(
      page.getByText('방문자 TEST0001', { exact: true }),
    ).toHaveCount(0)
    expect(api.reports()).toBe(0)
  })
}

test('로고의 한 번 클릭은 대시보드로 이동하고 본문 텍스트 선택은 유지한다', async ({
  page,
}) => {
  await mockAdmin(page)
  await page.goto('/#campaigns')
  await page
    .getByRole('link', { name: 'JB GOLF ACADEMY 대시보드', exact: true })
    .click()
  await expect(page).toHaveURL(/#overview$/)
  await expect(
    page.getByRole('heading', { name: '관리자 로그인', exact: true }),
  ).toHaveCount(0)
  await page.locator('.academy-brand-name').click({ clickCount: 3 })
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
  await expect(page).toHaveURL(/#overview$/)
  const heading = page.locator('#main h1').first()
  await expect(heading).toBeVisible()
  const headingBox = await heading.boundingBox()
  expect(headingBox).not.toBeNull()
  await page.mouse.click(
    headingBox!.x + 12,
    headingBox!.y + headingBox!.height / 2,
    {
      clickCount: 3,
    },
  )
  expect(
    await page.evaluate(() => window.getSelection()?.toString().trim()),
  ).toBeTruthy()
})

test('잘못된 비밀번호는 기록을 읽지 못하고 인증 후에만 익명 방문과 메뉴 체류를 표시한다', async ({
  page,
}) => {
  const api = await mockAdmin(page)
  await page.goto('/#admin')
  await page
    .getByLabel('관리자 비밀번호', { exact: true })
    .fill('wrong-synthetic-password')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    '비밀번호를 확인해 주세요',
  )
  expect(api.reports()).toBe(0)
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill(fakePassword)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '방문 기록.', exact: true }),
  ).toBeVisible()
  const visit = page.getByLabel('방문자 TEST0001 방문 기록', { exact: true })
  await expect(visit).toContainText('Chrome · 데스크톱')
  await expect(visit).toContainText('09:00:00')
  await expect(visit).toContainText('성과 대시보드')
  await expect(visit).toContainText('기사')
  await expect(visit).toContainText('1분 30초')
  await expect(visit).toContainText('45초')
  await expect(visit).toContainText('정확한 종료 시각은 확인되지 않았습니다')
  await expect(page.getByRole('region', { name: '방문 통계' })).toContainText(
    '2분 15초',
  )
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('조회 기간·페이지를 서버에서 다시 조회하고 로그아웃하면 기록을 즉시 숨긴다', async ({
  page,
}) => {
  const api = await mockAdmin(page, { authenticated: true, pages: 3 })
  await page.goto('/#admin')
  await expect(page.getByText('방문자 TEST0001', { exact: true })).toBeVisible()
  await page
    .getByRole('combobox', { name: '조회 기간', exact: true })
    .selectOption('7')
  await expect
    .poll(() =>
      api.queries.some(
        (query) => query.includes('days=7') && query.includes('page=1'),
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: '다음', exact: true }).click()
  await expect
    .poll(() =>
      api.queries.some(
        (query) => query.includes('days=7') && query.includes('page=2'),
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '관리자 로그인', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('방문자 TEST0001', { exact: true })).toHaveCount(
    0,
  )
  expect(api.logouts()).toBe(1)
})

test('빈 기록과 인증 만료를 구분하고 만료된 화면의 비공개 자료를 남기지 않는다', async ({
  page,
}) => {
  const api = await mockAdmin(page, { authenticated: true })
  await page.goto('/#admin')
  await expect(page.getByText('방문자 TEST0001', { exact: true })).toBeVisible()
  api.expire()
  await page
    .getByRole('combobox', { name: '조회 기간', exact: true })
    .selectOption('30')
  await expect(
    page.getByRole('heading', { name: '관리자 로그인', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('인증이 만료되었습니다')
  await expect(page.getByText('방문자 TEST0001', { exact: true })).toHaveCount(
    0,
  )
  await mockAdmin(page, { authenticated: true, empty: true })
  await page.reload()
  await expect(
    page.getByRole('heading', {
      name: '아직 방문 기록이 없습니다',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText('기능이 적용된 이후의 방문부터 기록됩니다.'),
  ).toBeVisible()
})

test('로그인 요청 제한을 안내하고 인증 없이 보고서를 요청하지 않는다', async ({
  page,
}) => {
  const api = await mockAdmin(page)
  await page.route('**/api/admin/login', (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: 'too_many_attempts' } },
    }),
  )
  await page.goto('/#admin')
  await page.getByLabel('관리자 비밀번호', { exact: true }).fill(fakePassword)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('로그인 시도가 많습니다')
  await expect(page.getByLabel('관리자 비밀번호', { exact: true })).toHaveValue(
    '',
  )
  expect(api.reports()).toBe(0)
})

for (const width of [320, 768, 1440]) {
  test(`관리자 방문 내역 ${width}px에서 화면이 넘치지 않는다`, async ({
    page,
  }) => {
    await mockAdmin(page, { authenticated: true })
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/#admin')
    await expect(
      page.getByText('방문자 TEST0001', { exact: true }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: `/tmp/jbgolf-admin-${width}.png`,
      fullPage: true,
    })
  })
}
