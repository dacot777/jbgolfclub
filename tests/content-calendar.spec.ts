import { expect, test, type Page } from '@playwright/test'
import {
  CALENDAR_ACCOUNTS,
  type CalendarMonth,
  type CalendarPost,
  type CalendarSchedule,
} from '../src/lib/calendar-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })
test.beforeEach(async ({ page }) => {
  await page.route('https://www.instagram.com/**/embed/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>Instagram</main>' }),
  )
})

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

async function mockStaff(page: Page) {
  const records = new Map([[plan.id, { ...plan }]])
  let failRead = false
  await page.clock.setFixedTime(new Date(day + 'T03:00:00Z'))
  await page.route('**/api/staff/session', (route) =>
    route.fulfill({
      json: { authenticated: true, csrfToken },
    }),
  )
  await page.route('**/api/admin/calendar?*', (route) => {
    const month = new URL(route.request().url()).searchParams.get('month')!
    return failRead
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ json: monthly(month, [...records.values()]) })
  })
  await page.route('**/api/admin/calendar/posts', (route) =>
    route.fulfill({
      json: {
        ...monthly('', []),
        month: 'latest',
        schedules: [...records.values()].filter((record) => record.permalink),
      },
    }),
  )
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

test('모바일 일정 달력에서 일정 브랜드와 지점을 보고 게시물 원문을 연다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockStaff(page)
  await page.goto('/#calendar')
  const calendar = page.getByRole('region', {
    name: '콘텐츠 캘린더',
  })
  const date = calendar.getByRole('button', { name: /^2026-11-17/ })
  await expect(date).toHaveAccessibleName(/콘텐츠 3개/)
  await expect(date.locator('img')).toHaveCount(1)
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
  await expect(calendar.getByText('전체 일정', { exact: true })).toBeVisible()
  await expect(
    calendar.getByRole('group', { name: /표시할 (브랜드|지점)/ }),
  ).toHaveCount(0)
  await expect(
    calendar.getByRole('button', {
      name: /^(전체 일정|JB골프클럽|JB아카데미|청담|서현)$/,
    }),
  ).toHaveCount(0)
  await expect(date).toContainText('서현')
  await expect(
    calendar.getByRole('heading', { name: '게시된 콘텐츠' }),
  ).toHaveCount(0)
  await expect(
    calendar.getByRole('navigation', { name: '계정별 게시물과 릴스 바로가기' }),
  ).toHaveCount(0)
  await expect(calendar.getByRole('button', { name: '계정 관리' })).toHaveCount(
    0,
  )
  await calendar.getByRole('button', { name: '다음 달' }).click()
  await expect(
    calendar.getByText('이달에 등록한 일정이 없습니다.'),
  ).toBeVisible()
  await calendar.getByRole('button', { name: '오늘', exact: true }).click()
  await expect(date).toHaveAccessibleName(/콘텐츠 3개/)
})

test('schedule creates, edits to a different month, and deletes after confirmation', async ({
  page,
}) => {
  const { records } = await mockStaff(page)
  await page.goto('/#calendar')
  await page.getByRole('button', { name: '일정 등록', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('일정 제목').fill('검증용 촬영')
  await expect(dialog.getByRole('radio', { name: '서현' })).toHaveCount(0)
  await dialog.getByRole('radio', { name: 'JB골프클럽', exact: true }).check()
  await expect(
    dialog.getByRole('button', { name: '저장', exact: true }),
  ).toBeDisabled()
  await dialog.getByRole('radio', { name: '청담', exact: true }).check()
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
    account: null,
    brand: 'club',
    branch: 'cheongdam',
    kind: 'reel',
    note: '테스트 메모',
  })
  await edit.click()
  await dialog.getByRole('radio', { name: /하우스 오브 제이비/ }).check()
  await expect(dialog.getByRole('radio', { name: '청담' })).toHaveCount(0)
  await dialog.getByLabel('날짜').fill('2026-12-01')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('heading', { name: '2026년 12월' })).toBeVisible()
  await expect(edit).toContainText('하우스 오브 제이비')
  expect(
    [...records.values()].find((item) => item.title === '검증용 촬영'),
  ).toMatchObject({ account: null, brand: 'haus', branch: null })
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

test('확정된 일정 네 그룹을 날짜 칸과 목록에서 색과 이름으로 구분하고 기존 미지정 지점을 보존한다', async ({
  page,
}) => {
  const { records } = await mockStaff(page)
  records.clear()
  const organizations = [
    { brand: 'academy', branch: null, label: 'JB아카데미' },
    { brand: 'club', branch: 'cheongdam', label: '청담' },
    { brand: 'club', branch: 'seohyeon', label: '서현' },
    { brand: 'haus', branch: null, label: 'Haus of JB' },
  ] as const
  for (const [index, org] of organizations.entries()) {
    const id = String(index + 1)
    records.set(id, {
      ...plan,
      id,
      title: '일정 ' + id,
      date: '2026-11-0' + id,
      account: null,
      brand: org.brand,
      branch: org.branch,
    })
  }
  records.set('legacy', {
    ...plan,
    id: 'legacy',
    title: '기존 공식 계정 일정',
    account: 'jbgolfclub_official',
  })
  await page.goto('/#calendar')
  const calendar = page.getByRole('region', {
    name: '콘텐츠 캘린더',
    exact: true,
  })
  const colors = new Set<string>()
  for (const [index, org] of organizations.entries()) {
    const id = String(index + 1)
    const date = calendar.getByRole('button', {
      name: new RegExp('^2026-11-0' + id + ','),
    })
    const mark = date.locator('.cc-brand-mark').last()
    await expect(mark).toContainText(org.label)
    colors.add(
      await mark.evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    await expect(
      calendar.getByRole('button', { name: '일정 ' + id + ' 일정 수정' }),
    ).toContainText(org.label)
  }
  expect(colors.size).toBe(4)
  await expect(
    calendar.getByRole('button', { name: '기존 공식 계정 일정 일정 수정' }),
  ).toContainText('지점 미지정')
})

test('담당자가 검색한 릴스의 게시일을 확인해 등록하고 원문을 열거나 삭제한다', async ({
  page,
}) => {
  const { records } = await mockStaff(page)
  await page.goto('/#instagram-posts')
  await page
    .getByRole('button', { name: '게시물 링크 등록', exact: true })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('실제 게시일')).toHaveValue('')
  await expect(dialog.getByLabel('실제 게시일')).toHaveAttribute('max', day)
  await dialog.getByLabel('게시물 제목').fill('직접 확인한 릴스')
  await dialog
    .getByRole('combobox', { name: '계정' })
    .selectOption('jbgolfclub_bundang')
  await dialog
    .getByLabel('Instagram 원문 주소')
    .fill('https://www.instagram.com/jbgolfacademy/reel/manual_fixture/')
  await dialog.getByLabel('실제 게시일').fill(day)
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    '선택한 계정의 Instagram',
  )
  await dialog
    .getByLabel('Instagram 원문 주소')
    .fill('https://www.instagram.com/reels/manual_fixture/?igsh=synthetic')
  await dialog.getByRole('button', { name: '저장', exact: true }).click()
  await expect(
    page.getByRole('link', { name: '직접 확인한 릴스 Instagram에서 보기' }),
  ).toHaveAttribute('href', 'https://www.instagram.com/reel/manual_fixture/')
  await expect(
    page.getByRole('region', { name: '계정별 최신 피드' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^(최신 피드|월별 보기)$/ }),
  ).toHaveCount(0)
  await expect(page.getByLabel('게시 월', { exact: true })).toHaveCount(0)
  await expect(page.getByText('전체 계정', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '골프클럽 분당', exact: true }),
  ).toHaveCount(0)
  expect(
    [...records.values()].find((r) => r.title === '직접 확인한 릴스'),
  ).toMatchObject({
    date: day,
    kind: 'reel',
    permalink: 'https://www.instagram.com/reel/manual_fixture/',
  })

  await expect(
    page.getByRole('link', { name: '직접 확인한 릴스 Instagram에서 보기' }),
  ).toContainText('직접 등록')
  const edit = page.getByRole('button', { name: '직접 확인한 릴스 링크 수정' })
  await edit.scrollIntoViewIfNeeded()
  await expect(edit).toBeInViewport()
  await edit.click()
  await dialog.getByRole('button', { name: '게시물 링크 삭제' }).click()
  await dialog.getByRole('button', { name: '삭제하기' }).click()
  await expect(
    page.getByRole('link', { name: '직접 확인한 릴스 Instagram에서 보기' }),
  ).toHaveCount(0)
})

test('동기화된 원문과 같은 등록 링크는 하루에 한 번만 표시하고 담당자가 수정할 수 있다', async ({
  page,
}) => {
  const { records } = await mockStaff(page)
  records.set(plan.id, {
    ...plan,
    account: posts[0].account,
    permalink: posts[0].permalink,
    title: '등록했던 원문',
  })
  await page.goto('/#instagram-posts')
  await expect(page.locator('.ig-post-grid > li')).toHaveCount(2)
  const dialog = page.getByRole('dialog')
  await expect(
    page.getByRole('link', { name: '테스트 게시물 Instagram에서 보기' }),
  ).toHaveAttribute('href', posts[0].permalink)
  await page.getByRole('button', { name: '테스트 게시물 링크 수정' }).click()
  await expect(dialog.getByLabel('Instagram 원문 주소')).toHaveValue(
    posts[0].permalink,
  )
  await expect(
    dialog.getByRole('button', { name: '게시물 링크 삭제' }),
  ).toBeVisible()
})

test('기기 연결 없이 공개 달력에서 썸네일과 일정을 열고 다른 달을 조회한다', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(day + 'T03:00:00Z'))
  await page.route('**/api/staff/session', (route) =>
    route.fulfill({ json: { authenticated: false } }),
  )
  const privateReads: string[] = []
  await page.route('**/api/admin/calendar**', (route) => {
    privateReads.push(route.request().url())
    return route.fulfill({ status: 401, json: {} })
  })
  await page.route('**/api/calendar?*', (route) => {
    expect(route.request().method()).toBe('GET')
    const month = new URL(route.request().url()).searchParams.get('month')!
    return route.fulfill({ json: monthly(month, [plan]) })
  })
  await page.goto('/#calendar')
  const calendar = page.getByRole('region', {
    name: '콘텐츠 캘린더',
  })
  const date = calendar.getByRole('button', { name: /^2026-11-17.*콘텐츠 3개/ })
  await expect(date.locator('img')).toHaveCount(1)
  await expect(
    calendar.getByRole('button', { name: '일정 등록', exact: true }),
  ).toBeVisible()
  await expect(calendar.getByRole('button', { name: '계정 관리' })).toHaveCount(
    0,
  )
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(
    calendar.getByRole('navigation', { name: '계정별 게시물과 릴스 바로가기' }),
  ).toHaveCount(0)
  await date.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(plan.title, { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole('link', { name: '테스트 릴스 Instagram에서 보기' }),
  ).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '이 날짜에 일정 등록' }),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: /수정|삭제/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await calendar.getByRole('button', { name: '다음 달' }).click()
  await expect(
    calendar.getByRole('heading', { name: '2026년 12월' }),
  ).toBeVisible()
  expect(privateReads).toEqual([])
})

for (const width of [390, 1440]) {
  test(`${width}px 공개 캘린더에서 일정 등록을 시작하고 업무 기기 연결 후 선택한 날짜에 저장한다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const { records } = await mockStaff(page)
    const grant = 'C'.repeat(43)
    let connected = false
    const prematureRequests: string[] = []
    page.on('request', (request) => {
      if (
        !connected &&
        new URL(request.url()).pathname.startsWith('/api/admin/calendar')
      )
        prematureRequests.push(request.url())
    })
    await page.route('**/api/staff/session', (route) =>
      route.fulfill({
        json: connected
          ? { authenticated: true, csrfToken }
          : { authenticated: false },
      }),
    )
    await page.route('**/api/calendar?*', (route) => {
      const month = new URL(route.request().url()).searchParams.get('month')!
      return route.fulfill({ json: monthly(month, [plan]) })
    })
    await page.route('**/api/staff/activate', (route) => {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON().token).toBe(grant)
      connected = true
      return route.fulfill({ json: { authenticated: true, csrfToken } })
    })

    await page.goto('/#calendar')
    const calendar = page.getByRole('region', { name: '콘텐츠 캘린더' })
    const register = calendar.getByRole('button', {
      name: '일정 등록',
      exact: true,
    })
    await expect(register).toBeInViewport()
    await expect(register).toBeEnabled()
    let scheduledDate = day
    if (width === 390) {
      await register.click()
    } else {
      scheduledDate = '2026-12-13'
      await calendar.getByRole('button', { name: '다음 달' }).click()
      await calendar.getByRole('button', { name: /^2026-12-13/ }).click()
      await page.getByRole('button', { name: '이 날짜에 일정 등록' }).click()
    }
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('날짜')).toHaveValue(scheduledDate)
    await dialog.getByLabel('일정 제목').fill('새 아카데미 일정')
    await dialog.getByRole('radio', { name: 'JB아카데미', exact: true }).check()
    await expect(
      dialog.getByRole('button', { name: '연결 파일 선택' }),
    ).toHaveCount(0)
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(
      dialog.getByRole('button', { name: '연결 파일 선택' }),
    ).toBeVisible()
    await expect(page.locator('input[type=password]')).toHaveCount(0)
    expect([...records.values()]).toEqual([plan])
    await dialog.getByLabel('담당자 연결 파일').setInputFiles({
      name: '운영-기기-연결.html',
      mimeType: 'text/html',
      buffer: Buffer.from(
        `<a href="https://jbgolf-connection.jbgolfacademy.workers.dev/#staff-device/${grant}">연결</a>`,
      ),
    })
    await expect(dialog.getByLabel('날짜')).toHaveValue(scheduledDate)
    await expect(dialog.getByLabel('일정 제목')).toHaveValue('새 아카데미 일정')
    await expect(
      dialog.getByRole('radio', { name: 'JB아카데미', exact: true }),
    ).toBeChecked()
    await expect(
      dialog.getByRole('button', { name: '연결 파일 선택' }),
    ).toHaveCount(0)
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    await expect(
      calendar.getByRole('button', { name: '새 아카데미 일정 일정 수정' }),
    ).toBeVisible()
    expect(
      [...records.values()].find((item) => item.title === '새 아카데미 일정'),
    ).toMatchObject({
      brand: 'academy',
      date: scheduledDate,
    })
    expect(prematureRequests).toEqual([])
    await expect(page).toHaveURL(/#calendar$/)
  })
}

test('피드를 직접 열면 광고 보고서나 광고 실적을 요청하지 않는다', async ({
  page,
}) => {
  const adRequests: string[] = []
  await page.route(/\/api\/(performance|meta-ads)([/?]|$)/, (route) => {
    adRequests.push(route.request().url())
    return route.fulfill({ status: 503, json: {} })
  })
  await page.route('**/api/staff/session', (route) =>
    route.fulfill({ json: { authenticated: false } }),
  )
  await page.route('**/api/calendar/posts', (route) =>
    route.fulfill({ json: { ...monthly('', []), month: 'latest' } }),
  )
  await page.goto('/#instagram-posts')
  await expect(
    page.getByRole('link', { name: '테스트 게시물 Instagram에서 보기' }),
  ).toBeVisible()
  expect(adRequests).toEqual([])
})

test('load error can be retried and shared view exposes no editing or connection controls', async ({
  page,
}) => {
  const mock = await mockStaff(page)
  mock.setFailRead(true)
  await page.goto('/#calendar')
  await expect(page.getByRole('alert')).toContainText(
    '달력을 불러오지 못했습니다.',
  )
  await expect(
    page.getByRole('link', { name: '아카데미 릴스 (새 창)' }),
  ).toHaveCount(0)
  mock.setFailRead(false)
  await page.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(
    page.getByRole('button', { name: /^2026-11-17.*콘텐츠 3개/ }),
  ).toBeVisible()
  const access = 'T'.repeat(43)
  await page.route('**/api/calendar/view?*', (route) => {
    expect(route.request().headers().authorization).toBe('Bearer ' + access)
    const month = new URL(route.request().url()).searchParams.get('month')!
    return route.fulfill({ json: monthly(month, [plan]) })
  })
  await page.goto('/#calendar-view/' + access)
  await expect(page.getByRole('button', { name: /^2026-11-17/ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '일정 등록', exact: true }),
  ).toHaveCount(0)
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
  const { records } = await mockStaff(page)
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

test('unconfigured staff device sees official setup path and a selectable redirect address', async ({
  page,
}) => {
  await mockStaff(page)
  await page.route('**/api/admin/calendar/posts', (route) => {
    const empty: CalendarMonth = {
      month: 'latest',
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
  await page.goto('/#instagram-posts')
  await page.getByRole('button', { name: '계정 관리' }).click()
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
