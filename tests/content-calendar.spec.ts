import { expect, test, type Page } from '@playwright/test'
import {
  CALENDAR_ACCOUNTS,
  type CalendarMonth,
  type CalendarPost,
  type CalendarSchedule,
} from '../src/lib/calendar-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })

const csrfToken = 'test-calendar-csrf'
const day = '2026-11-17'
const preview = '/brand/jb-academy-shield.png'
const posts: CalendarPost[] = [
  {
    id: 'fixture-one',
    account: 'jbgolfacademy',
    kind: 'post',
    title: '테스트 게시물',
    date: day,
    time: '10:20',
    thumbnailUrl: preview,
    permalink: 'https://www.instagram.com/p/fixture_one/',
  },
  {
    id: 'fixture-two',
    account: 'jbgolfclub_official',
    kind: 'reel',
    title: '테스트 릴스',
    date: day,
    time: '14:10',
    thumbnailUrl: preview,
    permalink: 'https://www.instagram.com/reel/fixture_two/',
  },
]
const plan: CalendarSchedule = {
  id: 'de3901c7-de58-43df-a73f-53ebf9bd8dab',
  account: 'jbgolfclub_bundang',
  kind: 'post',
  title: '테스트 일정',
  date: day,
  time: null,
  note: '',
  version: 1,
}

function monthly(month: string, schedules: CalendarSchedule[]): CalendarMonth {
  return {
    month,
    posts: posts.filter((p) => p.date.startsWith(month)),
    schedules: schedules.filter((s) => s.date.startsWith(month)),
    accounts: CALENDAR_ACCOUNTS.map((account) => ({
      account,
      status:
        account === 'jbgolfclub_bundang' ? 'needs_connection' : 'connected',
      lastSyncedAt:
        account === 'jbgolfclub_bundang' ? null : day + 'T01:00:00Z',
    })),
  }
}

async function mockOwner(page: Page) {
  const records = new Map([[plan.id, { ...plan }]])
  let failRead = false
  await page.clock.setFixedTime(new Date(day + 'T03:00:00Z'))
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      json: { configured: true, authenticated: true, csrfToken },
    }),
  )
  await page.route('**/api/admin/calendar?*', (route) => {
    const month = new URL(route.request().url()).searchParams.get('month')!
    return failRead
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: monthly(month, [...records.values()]) })
  })
  await page.route('**/api/admin/calendar/schedules**', (route) => {
    const request = route.request()
    expect(request.headers()['x-csrf-token']).toBe(csrfToken)
    const body = request.postDataJSON()
    if (request.method() === 'POST') {
      expect(body.id).toMatch(/^[a-f\d-]{36}$/)
      const item: CalendarSchedule = { ...body, version: 1 }
      records.set(item.id, item)
      return route.fulfill({ status: 201, json: { item } })
    }
    const id = new URL(request.url()).pathname.split('/').pop()!
    const current = records.get(id)!
    expect(body.version).toBe(current.version)
    if (request.method() === 'DELETE') {
      records.delete(id)
      return route.fulfill({ json: { deleted: true } })
    }
    expect(request.method()).toBe('PUT')
    const item: CalendarSchedule = { ...body, id, version: current.version + 1 }
    records.set(id, item)
    return route.fulfill({ json: { item } })
  })
  return {
    records,
    setFailRead: (fail: boolean) => {
      failRead = fail
    },
  }
}

test('calendar shows thumbnails before other entries and filters all three accounts on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockOwner(page)
  await page.goto('/#calendar')
  const calendar = page.getByRole('region', {
    name: '인스타그램 콘텐츠 캘린더',
  })
  const date = calendar.getByRole('button', { name: /^2026-11-17/ })
  await expect(date).toHaveAccessibleName(/콘텐츠 3개/)
  await expect(date.locator('img')).toHaveCount(2)
  await expect(date.locator('img').first()).toBeVisible()
  await expect(date).toContainText('+1')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await date.click()
  const details = page.getByRole('dialog')
  await expect(
    details.getByRole('link', { name: '테스트 릴스 Instagram에서 보기' }),
  ).toHaveAttribute('href', posts[1].permalink)
  await expect(
    details.getByRole('button', { name: '테스트 일정 일정 수정' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(date).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(
    calendar.getByRole('button', { name: /^2026-11-18/ }),
  ).toBeFocused()
  await calendar
    .getByRole('button', { name: '골프클럽 공식', exact: true })
    .click()
  await expect(date).toHaveAccessibleName(/콘텐츠 1개/)
  await expect(
    calendar.getByRole('link', { name: '테스트 게시물 Instagram에서 보기' }),
  ).toHaveCount(0)
  await calendar
    .getByRole('button', { name: '골프클럽 분당', exact: true })
    .click()
  await expect(date.locator('img')).toHaveCount(0)
  await expect(
    calendar.getByText('Instagram 계정을 연결하면', { exact: false }),
  ).toBeVisible()
  await calendar.getByRole('button', { name: '계정 관리', exact: true }).click()
  await expect(details.getByText('@jbgolfclub_bundang')).toBeVisible()
  await expect(details.getByText('Instagram 연결 설정 방법')).toHaveCount(0)
  await expect(
    details.getByRole('button', { name: '연결', exact: true }),
  ).toBeVisible()
  await page.mouse.click(3, 4)
  await expect(details).toHaveCount(0)
  await calendar.getByRole('button', { name: '다음 달' }).click()
  await expect(
    calendar.getByText('이달에 등록한 일정이 없습니다.'),
  ).toBeVisible()
  await calendar.getByRole('button', { name: '오늘', exact: true }).click()
  await expect(date).toHaveAccessibleName(/콘텐츠 1개/)
})

test('schedule creates, edits to a different month, and deletes after confirmation', async ({
  page,
}) => {
  const { records } = await mockOwner(page)
  await page.goto('/#calendar')
  await page.getByRole('button', { name: '일정 등록', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('일정 제목').fill('검증용 촬영')
  await dialog
    .getByRole('combobox', { name: '계정', exact: true })
    .selectOption('jbgolfclub_official')
  await dialog.getByRole('radio', { name: '릴스' }).check()
  await dialog.getByLabel('날짜').fill(day)
  await dialog.getByLabel('시간', { exact: false }).fill('17:40')
  await dialog.getByLabel('메모').fill('테스트 메모')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  const edit = page.getByRole('button', { name: '검증용 촬영 일정 수정' })
  await expect(edit).toBeVisible()
  expect(
    [...records.values()].find((s) => s.title === '검증용 촬영'),
  ).toMatchObject({
    date: day,
    time: '17:40',
    account: 'jbgolfclub_official',
    kind: 'reel',
    note: '테스트 메모',
  })
  await edit.click()
  await dialog.getByLabel('날짜').fill('2026-12-01')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2026년 12월' })).toBeVisible()
  await edit.click()
  await dialog.getByRole('button', { name: '일정 삭제' }).click()
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog.getByLabel('일정 제목')).toHaveValue('검증용 촬영')
  await dialog.getByRole('button', { name: '일정 삭제' }).click()
  await dialog.getByRole('button', { name: '삭제하기' }).click()
  await expect(edit).toHaveCount(0)
  await expect(page.getByText('이달에 등록한 일정이 없습니다.')).toBeVisible()
  expect([...records.values()]).toEqual([plan])
})

test('load error can be retried and shared view exposes no editing or connection controls', async ({
  page,
}) => {
  const mock = await mockOwner(page)
  mock.setFailRead(true)
  await page.goto('/#calendar')
  await expect(page.getByRole('alert')).toContainText(
    '달력을 불러오지 못했습니다.',
  )
  mock.setFailRead(false)
  await page.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(
    page.getByRole('link', { name: '테스트 게시물 Instagram에서 보기' }),
  ).toBeVisible()
  const access = 'T'.repeat(43)
  await page.route('**/api/calendar/view?*', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer ' + access)
    const month = new URL(route.request().url()).searchParams.get('month')!
    return route.fulfill({ json: monthly(month, [plan]) })
  })
  await page.goto('/#calendar-view/' + access)
  await expect(page.getByRole('button', { name: '계정 관리' })).toHaveCount(0)
  const date = page.getByRole('button', { name: /^2026-11-17.*콘텐츠 3개/ })
  await date.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('테스트 일정', { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: /등록|수정|삭제/ }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('link', { name: '테스트 릴스 Instagram에서 보기' }),
  ).toBeVisible()
})

test('stale schedule keeps the newer edit and offers a working refresh', async ({
  page,
}) => {
  const { records } = await mockOwner(page)
  await page.route('**/api/admin/calendar/schedules/' + plan.id, (route) => {
    records.set(plan.id, { ...plan, title: '다른 창에서 변경', version: 2 })
    return route.fulfill({
      status: 409,
      json: { error: { code: 'schedule_changed' } },
    })
  })
  await page.goto('/#calendar')
  await page.getByRole('button', { name: plan.title + ' 일정 수정' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('일정 제목').fill('오래된 변경')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    '다른 곳에서 일정이 변경되었습니다.',
  )
  await expect(
    dialog.getByRole('button', { name: '저장', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('button', { name: '달력 새로고침' }).click()
  await expect(
    page.getByRole('button', { name: '다른 창에서 변경 일정 수정' }),
  ).toBeVisible()
})

test('unconfigured owner sees official setup path and a selectable redirect address', async ({
  page,
}) => {
  await mockOwner(page)
  await page.route('**/api/admin/calendar?*', (route) => {
    const month = new URL(route.request().url()).searchParams.get('month')!
    const empty: CalendarMonth = {
      month,
      posts: [],
      schedules: [],
      accounts: CALENDAR_ACCOUNTS.map((account) => ({
        account,
        status: 'setup_required',
        lastSyncedAt: null,
      })),
    }
    return route.fulfill({ json: empty })
  })
  await page.goto('/#calendar')
  await page.getByRole('button', { name: '연결 상태 보기' }).click()
  const dialog = page.getByRole('dialog')
  const callback = dialog.getByRole('textbox', { name: '달력 리디렉션 주소' })
  await expect(callback).toBeHidden()
  await dialog.getByText('Instagram 연결 설정 방법').click()
  await expect(callback).toHaveValue(
    new URL('/api/auth/instagram/calendar/callback', page.url()).href,
  )
  await expect(callback).not.toBeEditable()
  await expect(
    dialog.getByText('INSTAGRAM_APP_SECRET', { exact: true }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: 'Meta 앱 대시보드' }),
  ).toHaveAttribute('href', 'https://developers.facebook.com/apps/')
  await expect(
    dialog.getByRole('button', { name: '연결', exact: true }),
  ).toHaveCount(0)
})
