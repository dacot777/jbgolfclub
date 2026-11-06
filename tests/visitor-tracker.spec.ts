import { test, expect, type Page } from '@playwright/test'
import type { AnalyticsEvent } from '../src/lib/analytics-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })

async function mockSite(page: Page) {
  const events: AnalyticsEvent[] = []
  await page.route('**/api/analytics/event', async (route) => {
    events.push(JSON.parse(route.request().postData() ?? '{}'))
    await route.fulfill({ status: 204 })
  })
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
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      json: {
        configured: true,
        authenticated: false,
      },
    }),
  )
  await page.addInitScript(() => {
    const state = window as Window & {
      __trackerVisibility?: string
      __trackerBeaconAttempts?: number
    }
    state.__trackerVisibility = 'visible'
    state.__trackerBeaconAttempts = 0
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state.__trackerVisibility,
    })
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => state.__trackerVisibility !== 'visible',
    })
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: () => {
        state.__trackerBeaconAttempts! += 1
        return false
      },
    })
  })
  return events
}

async function visibility(page: Page, value: 'visible' | 'hidden') {
  await page.evaluate((next) => {
    ;(window as Window & { __trackerVisibility?: string }).__trackerVisibility =
      next
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}

test('공개 메뉴마다 한 번 시작하고 같은 탭 방문을 유지하며 관리자·URL은 수집하지 않는다', async ({
  page,
}) => {
  const events = await mockSite(page)
  await page.goto('/?source=private-query-example#overview')
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(1)
  const first = events.find((event) => event.phase === 'enter')!
  expect(first.menu).toBe('overview')
  expect(first.activeMs).toBeGreaterThanOrEqual(0)
  await page.getByRole('link', { name: '광고 상세', exact: true }).click()
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(2)
  const second = events.filter((event) => event.phase === 'enter')[1]
  expect(second.menu).toBe('campaigns')
  expect(second.visitId).toBe(first.visitId)
  expect(second.viewId).not.toBe(first.viewId)
  await expect
    .poll(
      () =>
        events.filter(
          (event) => event.viewId === first.viewId && event.phase === 'leave',
        ).length,
    )
    .toBe(1)
  await page.getByRole('button', { name: '계정 연결', exact: true }).click()
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(3)
  expect(events.filter((event) => event.phase === 'enter')[2].menu).toBe(
    'connection',
  )
  await page.keyboard.press('Escape')
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(4)
  expect(events.filter((event) => event.phase === 'enter')[3].menu).toBe(
    'campaigns',
  )
  await page.evaluate(() => {
    window.location.hash = 'admin'
  })
  await expect(page.locator('input[type=password]')).toBeVisible()
  const entries = events.filter((event) => event.phase === 'enter').length
  await page.waitForTimeout(150)
  expect(events.filter((event) => event.phase === 'enter')).toHaveLength(
    entries,
  )
  expect(
    events.every(
      (event) =>
        event.menu === 'overview' ||
        event.menu === 'campaigns' ||
        event.menu === 'connection',
    ),
  ).toBe(true)
  expect(Object.keys(first).sort()).toEqual([
    'activeMs',
    'menu',
    'phase',
    'seq',
    'viewId',
    'visitId',
  ])
  expect(JSON.stringify(events)).not.toContain('private-query-example')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('첫 방문 쿠키 응답 전에 빠르게 이동·숨김해도 다음 요청을 직렬화한다', async ({
  page,
}) => {
  await mockSite(page)
  const requests: { event: AnalyticsEvent; cookie: string }[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/analytics/event', async (route) => {
    const event = JSON.parse(
      route.request().postData() ?? '{}',
    ) as AnalyticsEvent
    requests.push({
      event,
      cookie: (await route.request().allHeaders()).cookie ?? '',
    })
    if (requests.length === 1) await gate
    await route.fulfill({
      status: 204,
      headers: {
        'Set-Cookie':
          'synthetic_visitor=established; HttpOnly; Path=/; SameSite=Lax',
      },
    })
  })
  await page.goto('/')
  await expect.poll(() => requests.length).toBe(1)
  await page.getByRole('link', { name: '광고 상세', exact: true }).click()
  await visibility(page, 'hidden')
  await page.waitForTimeout(120)
  expect(requests).toHaveLength(1)
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __trackerBeaconAttempts?: number })
          .__trackerBeaconAttempts,
    ),
  ).toBe(0)
  release()
  await expect.poll(() => requests.length).toBe(4)
  expect(requests.map((request) => request.event.phase)).toEqual([
    'enter',
    'leave',
    'enter',
    'pause',
  ])
  expect(
    requests
      .slice(1)
      .every((request) =>
        request.cookie.includes('synthetic_visitor=established'),
      ),
  ).toBe(true)
  expect(new Set(requests.map((request) => request.event.visitId)).size).toBe(1)
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'synthetic_visitor',
  )
})

test('숨긴 탭에서는 체류 시간과 하트비트가 늘지 않고 돌아오면 이어서 측정한다', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-06T01:00:00Z') })
  const events = await mockSite(page)
  const responseFor = (phase: AnalyticsEvent['phase']) =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/analytics/event') &&
        JSON.parse(response.request().postData() ?? '{}').phase === phase,
    )
  const entered = responseFor('enter')
  await page.goto('/')
  await entered
  await expect.poll(() => events.length).toBe(1)
  await page.clock.runFor(10000)
  const pauseResponse = responseFor('pause')
  await visibility(page, 'hidden')
  await pauseResponse
  await expect
    .poll(() => events.some((event) => event.phase === 'pause'))
    .toBe(true)
  const paused = events.find((event) => event.phase === 'pause')!
  expect(paused.activeMs).toBeGreaterThanOrEqual(10000)
  const beforeHidden = events.length
  await page.clock.runFor(120000)
  expect(events).toHaveLength(beforeHidden)
  const resumeResponse = responseFor('resume')
  await visibility(page, 'visible')
  await resumeResponse
  await expect
    .poll(() => events.some((event) => event.phase === 'resume'))
    .toBe(true)
  const resumed = events.find((event) => event.phase === 'resume')!
  expect(resumed.activeMs - paused.activeMs).toBeLessThan(1000)
  // The interval's next tick is 20 seconds after resuming. Settle that network
  // response before advancing another 10 seconds past the transport timeout.
  const heartbeatResponse = responseFor('heartbeat')
  await page.clock.runFor(20000)
  await heartbeatResponse
  await page.clock.runFor(10000)
  await expect
    .poll(() => events.some((event) => event.phase === 'heartbeat'))
    .toBe(true)
  await page.getByRole('link', { name: '광고 상세', exact: true }).click()
  await expect
    .poll(() =>
      events.some(
        (event) => event.viewId === paused.viewId && event.phase === 'leave',
      ),
    )
    .toBe(true)
  const left = events.find(
    (event) => event.viewId === paused.viewId && event.phase === 'leave',
  )!
  expect(left.activeMs - paused.activeMs).toBeGreaterThanOrEqual(30000)
  expect(left.activeMs - paused.activeMs).toBeLessThan(34000)
  const viewEvents = events.filter((event) => event.viewId === paused.viewId)
  expect(
    viewEvents.every(
      (event, index) => index === 0 || event.seq > viewEvents[index - 1].seq,
    ),
  ).toBe(true)
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __trackerBeaconAttempts?: number })
          .__trackerBeaconAttempts,
    ),
  ).toBeGreaterThan(0)
})

test('페이지 닫기 이벤트는 한 번만 끝내고 30분 넘게 비활성이면 새 방문으로 시작한다', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-06T01:00:00Z') })
  const events = await mockSite(page)
  await page.goto('/')
  await expect.poll(() => events.length).toBe(1)
  const first = events[0]
  await visibility(page, 'hidden')
  await expect.poll(() => events.length).toBe(2)
  await page.clock.runFor(31 * 60 * 1000)
  await visibility(page, 'visible')
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(2)
  const second = events.filter((event) => event.phase === 'enter')[1]
  expect(second.visitId).not.toBe(first.visitId)
  expect(second.activeMs).toBeLessThan(1000)
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('jbgolf-analytics-visit')!).id,
    ),
  ).toBe(second.visitId)
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  })
  await expect
    .poll(
      () =>
        events.filter(
          (event) => event.viewId === second.viewId && event.phase === 'leave',
        ).length,
    )
    .toBe(1)
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  )
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(3)
  const restored = events.filter((event) => event.phase === 'enter')[2]
  expect(restored.visitId).toBe(second.visitId)
  expect(restored.viewId).not.toBe(second.viewId)
})

test('저장소가 막혀도 페이지가 동작하고 비밀 정보 없이 익명 이벤트만 보낸다', async ({
  page,
}) => {
  const events = await mockSite(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() =>
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Storage blocked', 'SecurityError')
      },
    }),
  )
  await page.goto('/')
  await expect.poll(() => events.length).toBe(1)
  const first = events[0]
  await page.getByRole('link', { name: '광고 상세', exact: true }).click()
  await expect
    .poll(() => events.filter((event) => event.phase === 'enter').length)
    .toBe(2)
  expect(events.filter((event) => event.phase === 'enter')[1].visitId).toBe(
    first.visitId,
  )
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  expect(errors).toEqual([])
})

test('추적 거부 설정과 정적 Pages에서는 이벤트나 방문 식별자를 만들지 않는다', async ({
  page,
  context,
}) => {
  const events = await mockSite(page)
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'globalPrivacyControl', {
      configurable: true,
      value: true,
    }),
  )
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '인스타그램 광고 성과.' }),
  ).toBeVisible()
  await page.getByRole('link', { name: '광고 상세', exact: true }).click()
  expect(events).toEqual([])
  expect(
    await page.evaluate(() => sessionStorage.getItem('jbgolf-analytics-visit')),
  ).toBeNull()
  const staticPage = await context.newPage()
  const staticEvents = await mockSite(staticPage)
  await staticPage.goto('http://127.0.0.1:5173/')
  await expect(
    staticPage.getByRole('heading', { name: '인스타그램 광고 성과.' }),
  ).toBeVisible()
  await staticPage.getByRole('link', { name: '광고 상세', exact: true }).click()
  expect(staticEvents).toEqual([])
  expect(
    await staticPage.evaluate(() =>
      sessionStorage.getItem('jbgolf-analytics-visit'),
    ),
  ).toBeNull()
})
