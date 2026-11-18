import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  PRODUCT_LABELS,
  type Inquiry,
  type InquiryInput,
} from '../src/lib/inquiry-types'

test.use({ baseURL: 'http://127.0.0.1:5174', hasTouch: true })

const demoAd = { id: 'synthetic-published-card', title: '검증 캠프 광고' }
const sessionToken = 'synthetic-inquiry-session-csrf'
const deviceGrant = 'T'.repeat(43)

type DatedProduct = Pick<InquiryInput, 'firstDate' | 'product'>

function editLabel(row: DatedProduct) {
  return (
    (row.firstDate ?? '미확인') +
    ' ' +
    PRODUCT_LABELS[row.product] +
    ' 문의 수정'
  )
}

function editableRow(page: Page, row: DatedProduct) {
  return page.getByRole('row').filter({
    has: page.getByRole('button', { name: editLabel(row), exact: true }),
  })
}

async function expectTotal(summary: Locator, count: number) {
  await expect(summary).toHaveText(
    new RegExp('^총 문의\\s*' + count + '\\s*건$'),
  )
}

async function expectVisibleTableHead(table: Locator) {
  await expect(table.locator('thead')).toBeVisible()
  expect(
    await table.locator('thead').evaluate((head) => {
      const rect = head.getBoundingClientRect()
      return (
        rect.height > 20 &&
        rect.width > 120 &&
        getComputedStyle(head).clipPath === 'none'
      )
    }),
  ).toBe(true)
}

async function mockWorkspace(page: Page, initiallySignedIn: boolean) {
  let signedIn = initiallySignedIn
  let grantUses = 0
  let reads = 0
  let analyticsEvents = 0
  const deletionRequests: string[] = []
  const records = new Map<string, Inquiry>()
  await page.route('**/api/inquiries/list', (route) => {
    expect(route.request().method()).toBe('GET')
    const rows = [...records.values()]
      .reverse()
      .map(
        ({ firstDate, product, branch, channel, source, assignee, stage }) => ({
          firstDate,
          product,
          branch,
          channel,
          source,
          assignee,
          stage,
        }),
      )
    return route.fulfill({ json: { rows } })
  })
  await page.route('**/api/analytics/event', (route) => {
    analyticsEvents++
    return route.fulfill({ status: 204 })
  })
  await page.route('**/api/staff/session', (route) =>
    route.fulfill({
      json: {
        authenticated: signedIn,
        ...(signedIn ? { csrfToken: sessionToken } : {}),
      },
    }),
  )
  await page.route('**/api/staff/activate', (route) => {
    expect(route.request().method()).toBe('POST')
    if (route.request().postDataJSON().token !== deviceGrant || grantUses > 0)
      return route.fulfill({
        status: 401,
        json: { error: { code: 'invalid_grant' } },
      })
    grantUses++
    signedIn = true
    return route.fulfill({
      json: { authenticated: true, csrfToken: sessionToken },
    })
  })
  await page.route('**/api/staff/logout', (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers()['x-csrf-token']).toBe(sessionToken)
    signedIn = false
    return route.fulfill({ json: { authenticated: false } })
  })
  await page.route('**/api/meta-ads', (route) =>
    route.fulfill({
      json: {
        status: 'ready',
        currency: 'KRW',
        periods: [],
        daily: [],
        cards: [demoAd],
      },
    }),
  )
  await page.route('**/api/admin/inquiries**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') reads++
    if (!signedIn)
      return route.fulfill({
        status: 401,
        json: { error: { code: 'authentication_required' } },
      })
    if (request.method() === 'GET')
      return route.fulfill({ json: { items: [...records.values()].reverse() } })
    expect(request.headers()['x-csrf-token']).toBe(sessionToken)
    const payload = request.postDataJSON()
    expect(payload).not.toHaveProperty('nextAction')
    if (request.method() === 'POST') {
      const { id, ...input } = payload
      expect(id).toMatch(/^[\da-f-]{36}$/i)
      const item = { ...input, id, version: 1 } as Inquiry
      records.set(id, item)
      return route.fulfill({ json: { item } })
    }
    const id = new URL(request.url()).pathname.split('/').pop()!
    const old = records.get(id)
    if (request.method() === 'DELETE') {
      deletionRequests.push(id)
      expect(Object.keys(payload)).toEqual(['version'])
      if (old && payload.version !== old.version)
        return route.fulfill({
          status: 409,
          json: { error: { code: 'conflict' } },
        })
      records.delete(id)
      return route.fulfill({ json: { deleted: true } })
    }
    expect(request.method()).toBe('PUT')
    expect(old).toBeDefined()
    expect(payload.version).toBe(old!.version)
    const item = {
      ...old,
      ...payload,
      id,
      version: old!.version + 1,
    } as Inquiry
    records.set(id, item)
    return route.fulfill({ json: { item } })
  })
  return {
    records,
    deletionRequests,
    reads: () => reads,
    analyticsEvents: () => analyticsEvents,
    grantUses: () => grantUses,
    setSignedIn: (value: boolean) => {
      signedIn = value
    },
  }
}

test('모바일과 PC는 같은 문의 현황을 보여주고 담당자 목록에는 문의자 이름도 표시한다', async ({
  context,
}) => {
  const original: Inquiry = {
    id: '562f664e-7b31-49fc-ac4e-5c867567f26d',
    version: 1,
    firstDate: '2026-01-10',
    branch: 'hanam',
    product: 'camp',
    channel: 'kakao',
    source: 'unknown',
    adId: null,
    stage: 'received',
    assignee: 'unassigned',
    name: '비공개 테스트 접수',
    contact: '비공개 테스트 연락처',
    note: '비공개 테스트 메모',
  }
  const newer: Inquiry = {
    ...original,
    id: 'd7bceeb0-a730-41f7-93fb-2ee09967ab74',
    firstDate: '2026-01-12',
    source: 'instagram_ad',
    adId: demoAd.id,
    branch: 'cheongdam',
    product: 'lesson',
    stage: 'consulting',
    assignee: 'kim_yeoul',
    name: '테스트 두 번째 접수',
  }
  const duplicate = {
    ...newer,
    id: '87169e84-a8d6-4b6b-a5e8-46c66691950c',
    name: '테스트 세 번째 접수',
  }
  const headers = [
    '접수일',
    '관심 상품',
    '지점',
    '문의 채널',
    '유입 경로',
    '담당자',
    '진행 상태',
  ]
  let firstRows: string[][] | undefined
  for (const { width, staff } of [
    { width: 390, staff: false },
    { width: 1440, staff: true },
    { width: 1440, staff: false },
    { width: 390, staff: true },
  ]) {
    const page = await context.newPage()
    const api = await mockWorkspace(page, staff)
    for (const row of [original, newer, duplicate]) api.records.set(row.id, row)
    await page.setViewportSize({ width, height: 850 })
    const sessionRead = page.waitForResponse('**/api/staff/session')
    await page.goto('/#inquiries')
    await sessionRead
    if (staff)
      await expect(
        page.getByRole('button', { name: '새 문의', exact: true }),
      ).toBeVisible()
    await expectTotal(page.getByLabel('전체 문의 현황'), 3)
    const table = page.getByRole('table', { name: '문의 목록 표', exact: true })
    await expectVisibleTableHead(table)
    await expect(table.getByRole('columnheader')).toHaveText(
      staff ? ['문의자', ...headers] : headers,
    )
    if (width === 390) {
      const region = page.getByRole('region', {
        name: '문의 목록 표',
        exact: true,
      })
      expect(
        await region.evaluate((element) => {
          element.scrollLeft = element.scrollWidth
          const lastHeading = element.querySelector('th:last-child')!
          const showsLastColumn =
            lastHeading.getBoundingClientRect().right <=
            element.getBoundingClientRect().right + 1
          const scrolled = element.scrollLeft > 0
          element.scrollLeft = 0
          return scrolled && showsLastColumn
        }),
      ).toBe(true)
    }
    const body = table.locator('tbody tr')
    await expect(body).toHaveCount(3)
    const allCells = await body.evaluateAll((elements) =>
      elements.map((row) =>
        Array.from(row.querySelectorAll('th,td'), (cell) => {
          const copy = cell.cloneNode(true) as HTMLElement
          copy.querySelectorAll('button').forEach((button) => button.remove())
          return copy.textContent?.trim() ?? ''
        }),
      ),
    )
    if (staff) {
      expect(allCells.map((cells) => cells[0])).toEqual([
        duplicate.name,
        newer.name,
        original.name,
      ])
      for (const row of [original, newer, duplicate])
        await expect(table.getByText(row.name, { exact: true })).toBeVisible()
    } else {
      await expect(
        table.getByRole('columnheader', { name: '문의자', exact: true }),
      ).toHaveCount(0)
    }
    for (const secret of [original.contact, original.note])
      await expect(page.locator('body')).not.toContainText(secret)
    const rows = staff ? allCells.map((cells) => cells.slice(1)) : allCells
    expect(rows[0]).toEqual(rows[1])
    expect(rows[2]).not.toEqual(rows[0])
    expect(rows[0]).toEqual(
      expect.arrayContaining([
        '레슨',
        '청담',
        '카카오채널',
        '인스타그램 광고',
        '김여울 대리님',
        '상담 중',
      ]),
    )
    expect(rows[0][0]).toContain('2026')
    if (firstRows) expect(rows).toEqual(firstRows)
    else firstRows = rows
    await page.getByRole('button', { name: '필터', exact: true }).click()
    await page
      .getByLabel('담당자 필터', { exact: true })
      .selectOption('kim_yeoul')
    await expect(body).toHaveCount(2)
    await page.getByLabel('담당자 필터', { exact: true }).selectOption('')
    await page.getByLabel('상품 필터', { exact: true }).selectOption('camp')
    await expect(body).toHaveCount(1)
    await expect(body).toContainText('하남')
    await expect(page.getByLabel('광고 필터', { exact: true })).toHaveCount(
      staff ? 1 : 0,
    )
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    if (!staff) {
      for (const secret of [original.name, original.contact, original.note])
        await expect(page.locator('body')).not.toContainText(secret)
      expect(api.reads()).toBe(0)
    }
    await page.close()
  }
})

for (const width of [390, 1440]) {
  test(`${width}px 처음 쓰는 브라우저에서 문의 목록을 바로 열고 새로고침한다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 850 })
    const api = await mockWorkspace(page, false)
    let releaseSession: () => void
    const pendingSession = new Promise<void>((resolve) => {
      releaseSession = resolve
    })
    await page.route('**/api/staff/session', async (route) => {
      await pendingSession
      await route.fulfill({ json: { authenticated: false } })
    })
    const rows = [
      {
        product: 'camp',
        branch: 'hanam',
        channel: 'kakao',
        stage: 'received',
        firstDate: '2026-01-10',
        source: 'instagram_post',
        assignee: 'kim_uihyeon',
      },
      {
        product: 'lesson',
        branch: null,
        channel: 'instagram_dm',
        stage: 'consulting',
        firstDate: null,
        source: 'unknown',
        assignee: 'unassigned',
      },
    ]
    let listReads = 0
    await page.route('**/api/inquiries/list', (route) => {
      expect(route.request().method()).toBe('GET')
      listReads++
      return route.fulfill({ json: { rows } })
    })
    const restrictedRequests: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (
        path.startsWith('/api/admin/inquiries') ||
        path === '/api/staff/activate'
      ) {
        restrictedRequests.push(path)
      }
    })
    await page.goto('/#inquiries')
    const table = page.getByRole('table', { name: '문의 목록 표', exact: true })
    const total = page.getByLabel('전체 문의 현황')
    try {
      await expect(table).toBeVisible()
    } finally {
      releaseSession!()
    }
    await expectTotal(total, 2)
    const campRow = table.getByRole('row').filter({ hasText: '전지훈련' })
    for (const value of [
      '하남',
      '카카오채널',
      '문의 접수',
      '김의현 원장님',
      '인스타그램 게시물',
    ]) {
      await expect(campRow).toContainText(value)
    }
    const lessonRow = table.getByRole('row').filter({ hasText: '레슨' })
    for (const value of ['인스타그램 DM', '상담 중', '미배정', '미확인']) {
      await expect(lessonRow).toContainText(value)
    }
    await expect(table.getByRole('columnheader')).toHaveCount(7)
    await expectVisibleTableHead(table)
    await expect(
      table.getByRole('columnheader', {
        name: /이름|연락처|메모|고객 구분/,
      }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /QR|연결 파일 선택|새 문의|수정|삭제/ }),
    ).toHaveCount(0)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    const readsBeforeReload = listReads
    await page.reload()
    await expectTotal(total, 2)
    await expect(campRow).toBeVisible()
    expect(listReads).toBeGreaterThan(readsBeforeReload)
    expect(restrictedRequests).toEqual([])
    expect(api.reads()).toBe(0)
  })
}

for (const staff of [false, true]) {
  test(`${staff ? '담당자 PC' : '일반 휴대폰'}에서 열어 둔 문의 목록은 새 문의를 반영한다`, async ({
    page,
  }) => {
    const api = await mockWorkspace(page, staff)
    await page.setViewportSize({ width: staff ? 1440 : 390, height: 850 })
    await page.clock.install()
    await page.goto('/#inquiries')
    if (staff)
      await expect(
        page.getByRole('button', { name: '새 문의', exact: true }),
      ).toBeVisible()
    const total = page.getByLabel('전체 문의 현황')
    await expectTotal(total, 0)
    const incoming: Inquiry = {
      id: '5430f496-e602-47d7-a95a-f93836fd5577',
      version: 1,
      firstDate: '2026-01-14',
      product: 'lesson',
      branch: 'seohyeon',
      channel: 'phone',
      source: 'search',
      adId: null,
      stage: 'received',
      assignee: 'unassigned',
      name: '',
      contact: '',
      note: '',
    }
    api.records.set(incoming.id, incoming)
    await page.clock.fastForward(61_000)
    await expectTotal(total, 1)
    await expect(page.getByRole('table').getByRole('row').last()).toContainText(
      '서현',
    )
    if (staff)
      await expect(
        page.getByRole('table').getByText('이름 미입력', { exact: true }),
      ).toBeVisible()
    api.records.delete(incoming.id)
    await page.clock.fastForward(2000)
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange')),
    )
    await expectTotal(total, 0)
    if (!staff) expect(api.reads()).toBe(0)
  })
}

test('공개 문의 목록 조회 오류는 0건으로 표시하지 않고 다시 불러온 결과만 빈 상태로 표시한다', async ({
  page,
}) => {
  await mockWorkspace(page, false)
  let unavailable = true
  await page.route('**/api/inquiries/list', (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } })
      : route.fulfill({ json: { rows: [] } }),
  )
  await page.goto('/#inquiries')
  await expect(page.getByRole('alert')).toContainText(
    '문의 목록을 불러오지 못했습니다.',
  )
  await expect(page.getByLabel('전체 문의 현황')).toHaveCount(0)
  await expect(
    page.getByText('등록된 문의가 없습니다.', { exact: true }),
  ).toHaveCount(0)
  unavailable = false
  await page.getByRole('button', { name: '다시 불러오기' }).click()
  await expect(
    page.getByText('등록된 문의가 없습니다.', { exact: true }),
  ).toBeVisible()
  await expectTotal(page.getByLabel('전체 문의 현황'), 0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('담당자 연결 후 이름과 관리 기능이 표시되고 해제하면 개인정보를 지운다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
  const person: Inquiry = {
    id: '371ea65c-d544-4fc7-915a-008d78f65ca7',
    version: 1,
    firstDate: '2026-01-16',
    branch: 'hanam',
    product: 'lesson',
    channel: 'phone',
    source: 'unknown',
    adId: null,
    stage: 'received',
    assignee: 'unassigned',
    name: '권한 확인용 문의자',
    contact: '비공개 연락처 검증',
    note: '비공개 상담 메모 검증',
  }
  api.records.set(person.id, person)
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      json: {
        configured: true,
        authenticated: true,
        csrfToken: 'analytics-only',
      },
    }),
  )
  await page.goto('/#inquiries')
  await expect(
    page.getByRole('heading', { name: /문의·상담 현황/ }),
  ).toBeVisible()
  await expect(page.getByText('담당자 도구', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '연결 파일 선택' }),
  ).toBeHidden()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '새 문의', exact: true }),
  ).toHaveCount(0)
  expect(api.reads()).toBe(0)
  await expect(page.locator('body')).not.toContainText(person.name)
  await page.goto('/#staff-device/' + deviceGrant)
  await expect(page).toHaveURL(/#calendar$/)
  await page.goto('/#inquiries')
  await expect(
    page.getByRole('heading', { name: '문의 목록', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '새 문의', exact: true }),
  ).toBeVisible()
  expect(api.reads()).toBeGreaterThan(0)
  const summary = page.getByLabel('전체 문의 현황')
  await expectTotal(summary, 1)
  await expect(
    page.getByRole('table').getByText(person.name, { exact: true }),
  ).toBeVisible()
  for (const secret of [person.contact, person.note])
    await expect(page.locator('body')).not.toContainText(secret)
  await page.getByRole('button', { name: '이 기기 연결 해제' }).click()
  await expect(page.getByText('담당자 도구', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '연결 파일 선택' }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: '새 문의', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(person.name)
  await expect(
    page.getByRole('columnheader', { name: '문의자', exact: true }),
  ).toHaveCount(0)
  await expectTotal(summary, 1)
  expect(api.analyticsEvents()).toBe(0)
})

test('문의 화면에서 선택한 연결 파일의 사이트를 검증하고 같은 탭에서 문의를 연다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
  await page.goto('/#inquiries')
  await page.getByText('담당자 도구', { exact: true }).click()
  const makeLauncher = (href: string) => ({
    name: '운영-기기-연결.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<a href="' + href + '">연결</a>'),
  })
  const hosted = 'https://jbgolf-connection.jbgolfacademy.workers.dev'
  const file = page.getByLabel('담당자 연결 파일')
  let attempts = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/staff/activate') attempts++
  })
  await file.setInputFiles(
    makeLauncher(hosted + '.example/#staff-device/' + deviceGrant),
  )
  await expect(page.getByRole('alert')).toContainText('파일 이름')
  expect(attempts).toBe(0)
  await file.setInputFiles(
    makeLauncher(hosted + '/#staff-device/' + 'X'.repeat(43)),
  )
  await expect(page.getByRole('alert')).toContainText('사용 기한')
  expect(api.reads()).toBe(0)
  await file.setInputFiles(
    makeLauncher(hosted + '/#staff-device/' + deviceGrant),
  )
  await expect(
    page.getByRole('button', { name: '새 문의', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/#inquiries$/)
  expect(api.grantUses()).toBe(1)
  expect(
    await page.evaluate(() => document.documentElement.innerText),
  ).not.toContain(deviceGrant)
})

test('캘린더에서 문의·상담으로 이동하면 다른 탭에서 연결한 업무 기기의 문의 목록이 바로 열린다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
  api.records.set('test-inquiry', {
    id: 'test-inquiry',
    version: 1,
    firstDate: null,
    product: 'lesson',
    branch: 'cheongdam',
    channel: 'phone',
    source: 'unknown',
    adId: null,
    stage: 'received',
    assignee: 'unassigned',
    name: '검증용 레슨 문의',
    contact: '',
    note: '',
  })
  await page.goto('/#inquiries')
  await expect(page.getByText('담당자 도구', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '연결 파일 선택' }),
  ).toBeHidden()
  expect(api.reads()).toBe(0)
  await page.getByRole('link', { name: '콘텐츠 캘린더', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '콘텐츠 캘린더' }),
  ).toBeVisible()
  // Same document remains focused across both navigations.
  api.setSignedIn(true)
  await page.getByRole('link', { name: '문의·상담', exact: true }).click()
  await expect(
    editableRow(page, { firstDate: null, product: 'lesson' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '필터', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('상품 필터')).toBeHidden()
  await expectTotal(page.getByLabel('전체 문의 현황'), 1)
  await expect(
    page.getByRole('button', { name: '연결 파일 선택' }),
  ).toHaveCount(0)
})

test('다른 탭에서 담당자 연결을 마치거나 해제한 뒤 기존 문의 화면에서 확인된다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
  await page.goto('/#inquiries')
  const recheck = page.getByRole('button', { name: '연결 상태 다시 확인' })
  await expect(page.getByText('담당자 도구', { exact: true })).toBeVisible()
  await expect(recheck).toBeHidden()
  api.setSignedIn(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const list = page.getByRole('heading', { name: '문의 목록' })
  const privateEditor = page.getByRole('button', {
    name: '새 문의',
    exact: true,
  })
  await expect(privateEditor).toBeVisible()
  api.setSignedIn(false)
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  )
  await expect(privateEditor).toHaveCount(0)
  await expect(list).toBeVisible()
  await page.getByText('담당자 도구', { exact: true }).click()
  await expect(recheck).toBeVisible()
  api.setSignedIn(true)
  await recheck.click()
  await expect(privateEditor).toBeVisible()
})

test('캠프와 레슨 문의를 별도로 저장하고 담당자 인계와 필터를 새로고침 후에도 확인한다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, true)
  await page.setViewportSize({ width: 375, height: 850 })
  await page.goto('/#inquiries')
  const camp: InquiryInput = {
    firstDate: '2026-11-10',
    branch: 'hanam',
    product: 'camp',
    channel: 'kakao',
    source: 'instagram_ad',
    adId: demoAd.id,
    stage: 'received',
    assignee: 'kim_yeoul',
    customerType: 'junior',
    name: '검증 캠프 A',
    contact: '',
    note: '캠프 신청 일정 확인',
  }
  const lesson: InquiryInput = {
    firstDate: '2026-11-11',
    branch: null,
    product: 'lesson',
    channel: 'phone',
    source: 'search',
    adId: null,
    stage: 'consulting',
    assignee: 'unassigned',
    customerType: 'adult',
    name: '검증 레슨 B',
    contact: '',
    note: '레슨 시간 확인',
  }
  for (const input of [camp, lesson]) {
    await page.getByRole('button', { name: '새 문의', exact: true }).click()
    await expect(page.locator('.iq-choices legend')).toHaveText([
      '인계 담당자',
      '문의 대상',
      '지점',
    ])
    const customer = page.getByRole('group', { name: '문의 대상' })
    await expect(customer.getByRole('radio', { name: '미지정' })).toBeChecked()
    const customerLabel = input.customerType === 'junior' ? '주니어' : '일반인'
    await customer.getByRole('radio', { name: customerLabel }).check()
    await expect(page.getByLabel('다음 할 일', { exact: true })).toHaveCount(0)
    const branch = page.getByRole('group', { name: '지점', exact: true })
    await expect(branch.getByRole('radio', { name: '미지정' })).toBeChecked()
    for (const label of ['하남', '청담', '서현'])
      await expect(
        branch.getByRole('radio', { name: label, exact: true }),
      ).toBeVisible()
    if (input.branch) await branch.getByRole('radio', { name: '하남' }).check()
    await expect(
      page.getByRole('button', { name: '문의 삭제', exact: true }),
    ).toHaveCount(0)
    await page
      .getByRole('combobox', { name: '관심 상품', exact: true })
      .selectOption(input.product)
    await page
      .getByRole('combobox', { name: '문의 채널', exact: true })
      .selectOption(input.channel)
    await page
      .getByRole('combobox', { name: '유입 경로', exact: true })
      .selectOption(input.source)
    if (input.adId)
      await page
        .getByRole('combobox', { name: '확인된 광고', exact: true })
        .selectOption(input.adId)
    else
      await expect(
        page.getByRole('combobox', { name: '확인된 광고', exact: true }),
      ).toHaveCount(0)
    await page
      .getByRole('combobox', { name: '진행 상태', exact: true })
      .selectOption(input.stage)
    await page.getByLabel('최초 문의일', { exact: true }).fill(input.firstDate!)
    await page.getByLabel('이름 또는 별칭', { exact: true }).fill(input.name)
    await page
      .getByRole('textbox', { name: '상담 메모', exact: true })
      .fill(input.note)
    await page
      .getByRole('radio', {
        name: input.assignee === 'kim_yeoul' ? '김여울 대리님' : '미배정',
        exact: true,
      })
      .check()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(
      page.getByRole('button', { name: editLabel(input), exact: true }),
    ).toBeVisible()
    await expect(editableRow(page, input)).not.toContainText(customerLabel)
    await expect(editableRow(page, input)).toContainText(input.name)
  }
  const saved = [...api.records.values()]
  expect(saved).toHaveLength(2)
  expect(saved[0]).toMatchObject({ ...camp, version: 1 })
  expect(saved[1]).toMatchObject({ ...lesson, version: 1 })

  await page.getByRole('button', { name: editLabel(camp), exact: true }).click()
  await expect(
    page.getByRole('radio', { name: '김여울 대리님', exact: true }),
  ).toBeChecked()
  await page.getByRole('radio', { name: '김의현 원장님', exact: true }).check()
  await expect(
    page.getByRole('radio', { name: '주니어', exact: true }),
  ).toBeChecked()
  const branch = page.getByRole('group', { name: '지점', exact: true })
  await expect(branch.getByRole('radio', { name: '하남' })).toBeChecked()
  await branch.getByRole('radio', { name: '청담' }).check()
  const updatedName = '검증 캠프 A 이름 수정'
  await page.getByLabel('이름 또는 별칭', { exact: true }).fill(updatedName)
  await page
    .getByRole('combobox', { name: '진행 상태', exact: true })
    .selectOption('completed')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect.poll(() => api.records.get(saved[0].id)?.version).toBe(2)
  expect(api.records.get(saved[0].id)).toMatchObject({
    ...camp,
    name: updatedName,
    branch: 'cheongdam',
    assignee: 'kim_uihyeon',
    stage: 'completed',
  })
  expect(api.records.get(saved[1].id)).toMatchObject({ ...lesson, version: 1 })
  await expectTotal(page.getByLabel('전체 문의 현황'), 2)
  await expect(editableRow(page, camp)).toContainText(updatedName)

  const beforeReload = api.reads()
  await page.reload()
  await expect.poll(() => api.reads()).toBeGreaterThan(beforeReload)
  await expect(editableRow(page, camp)).toContainText('청담')
  await expect(editableRow(page, camp)).toContainText(updatedName)
  const adFilter = page.getByLabel('광고 필터', { exact: true })
  await expect(adFilter).toBeHidden()
  await page.getByRole('button', { name: '필터', exact: true }).click()
  await adFilter.selectOption(demoAd.id)
  await expectTotal(page.getByLabel('전체 문의 현황'), 2)
  await expect(page.getByLabel('선택한 조건의 문의 현황')).toHaveText(
    '필터 결과 1건',
  )
  await expect(
    page.getByRole('button', { name: editLabel(lesson), exact: true }),
  ).toHaveCount(0)
  await adFilter.selectOption('')
  await page
    .getByLabel('담당자 필터', { exact: true })
    .selectOption('kim_uihyeon')
  await expect(
    page.getByRole('button', { name: editLabel(camp), exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: editLabel(lesson), exact: true }),
  ).toHaveCount(0)
  const filteredSummary = page.getByLabel('선택한 조건의 문의 현황')
  await expect(filteredSummary).toHaveText('필터 결과 1건')
  await page
    .getByLabel('담당자 필터', { exact: true })
    .selectOption('unassigned')
  await page.getByLabel('상품 필터', { exact: true }).selectOption('lesson')
  await expect(
    page.getByRole('button', { name: editLabel(lesson), exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: editLabel(camp), exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '필터 적용 중' }).click()
  await expect(adFilter).toBeHidden()
  await expect(filteredSummary).toHaveText('필터 결과 1건')
  await page
    .getByRole('button', { name: editLabel(lesson), exact: true })
    .click()
  await expect(
    page.getByRole('combobox', { name: '문의 채널', exact: true }),
  ).toHaveValue('phone')
  await expect(
    page.getByRole('combobox', { name: '유입 경로', exact: true }),
  ).toHaveValue('search')
  await expect(
    page.getByRole('radio', { name: '미배정', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('textbox', { name: '상담 메모', exact: true }),
  ).toHaveValue(lesson.note)
  await page.getByRole('button', { name: '취소', exact: true }).click()
  const browserStorage = await page.evaluate(() =>
    JSON.stringify([
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]),
  )
  for (const sensitive of [
    lesson.name,
    lesson.note,
    camp.name,
    camp.note,
    sessionToken,
  ])
    expect(browserStorage).not.toContain(sensitive)
  expect(api.analyticsEvents()).toBe(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('새 문의는 바깥 클릭으로 저장 없이 닫히고 다시 열면 입력값이 초기화된다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, true)
  await page.setViewportSize({ width: 375, height: 850 })
  await page.goto('/#inquiries')
  const opener = page.getByRole('button', { name: '새 문의', exact: true })
  const editor = page.getByRole('dialog', { name: '새 문의 기록' })
  await opener.click()
  await editor.getByRole('radio', { name: '청담' }).check()
  const alias = editor.getByLabel('이름 또는 별칭', { exact: true })
  await alias.fill('미저장 검증')
  await page.mouse.click(2, 2)
  await expect(editor).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expectTotal(page.getByLabel('전체 문의 현황'), 0)
  expect(api.records.size).toBe(0)

  await opener.click()
  await expect(alias).toBeEmpty()
  await expect(
    editor
      .getByRole('group', { name: '지점' })
      .getByRole('radio', { name: '미지정' }),
  ).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await opener.click()
  await editor.getByRole('button', { name: '닫기' }).click()
  await expect(editor).toHaveCount(0)
})

test('기존 문의의 지점을 지정·해제하고 확인한 문의만 삭제해 총 건수를 갱신한다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, true)
  const legacy: Inquiry = {
    id: 'd1b11b4d-28c7-4673-bc79-f25439a345fb',
    version: 1,
    firstDate: null,
    branch: null,
    product: 'lesson',
    channel: 'phone',
    source: 'unknown',
    adId: null,
    stage: 'completed',
    assignee: 'unassigned',
    name: '삭제 대상 검증',
    contact: '',
    note: '',
    nextAction: '기존 보존 기록',
  }
  const remaining: Inquiry = {
    ...legacy,
    id: '6df70d74-ce66-45ab-80f0-cbe276b91c42',
    branch: 'hanam',
    stage: 'received',
    name: '보존 대상 검증',
  }
  api.records.set(legacy.id, legacy)
  api.records.set(remaining.id, remaining)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#inquiries')
  const total = page.getByLabel('전체 문의 현황')
  const targetRow = editableRow(page, legacy).filter({
    hasText: '신청·등록 완료',
  })
  await expectTotal(total, 2)
  await expect(targetRow).toContainText('미지정')
  await targetRow
    .getByRole('button', { name: editLabel(legacy), exact: true })
    .click()
  const branch = page.getByRole('group', { name: '지점', exact: true })
  const customer = page.getByRole('group', { name: '문의 대상', exact: true })
  await expect(
    page.getByText('이전에 기록한 다음 할 일', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('기존 보존 기록', { exact: true })).toBeVisible()
  await expect(customer.getByRole('radio', { name: '미지정' })).toBeChecked()
  await expect(page.getByLabel('다음 할 일', { exact: true })).toHaveCount(0)
  await customer.getByRole('radio', { name: '주니어' }).check()
  await expect(branch.getByRole('radio', { name: '미지정' })).toBeChecked()
  await branch.getByRole('radio', { name: '서현' }).check()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(targetRow).toContainText('서현')
  await expect(targetRow).not.toContainText('주니어')
  await targetRow
    .getByRole('button', { name: editLabel(legacy), exact: true })
    .click()
  await expect(branch.getByRole('radio', { name: '서현' })).toBeChecked()
  await expect(customer.getByRole('radio', { name: '주니어' })).toBeChecked()
  await customer.getByRole('radio', { name: '미지정' }).check()
  await branch.getByRole('radio', { name: '미지정' }).check()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(targetRow).toContainText('미지정')
  expect(api.records.get(legacy.id)?.branch).toBeNull()
  expect(api.records.get(legacy.id)?.customerType).toBeNull()
  expect(api.records.get(legacy.id)?.nextAction).toBe('기존 보존 기록')
  await targetRow
    .getByRole('button', { name: editLabel(legacy), exact: true })
    .click()
  const remove = page.getByRole('button', { name: '문의 삭제', exact: true })
  const confirmation = page.getByRole('alertdialog', { name: '문의 삭제 확인' })
  await remove.click()
  await expect(confirmation).toContainText(legacy.name)
  await page.touchscreen.tap(2, 2)
  await expect(confirmation).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '문의 수정' })).toBeVisible()
  expect(api.deletionRequests).toHaveLength(0)
  await remove.click()
  await confirmation.getByRole('button', { name: '취소', exact: true }).click()
  await expect(confirmation).toHaveCount(0)
  expect(api.deletionRequests).toHaveLength(0)
  expect(api.records.size).toBe(2)

  await remove.click()
  const revised = {
    ...api.records.get(legacy.id)!,
    version: api.records.get(legacy.id)!.version + 1,
    branch: 'cheongdam',
  } as const
  api.records.set(legacy.id, revised)
  await confirmation
    .getByRole('button', { name: '삭제하기', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: '최신 기록 열기' }),
  ).toBeVisible()
  expect(api.records.get(legacy.id)).toEqual(revised)
  await page.getByRole('button', { name: '최신 기록 열기' }).click()
  await expect(branch.getByRole('radio', { name: '청담' })).toBeChecked()
  await remove.click()
  await confirmation
    .getByRole('button', { name: '삭제하기', exact: true })
    .click()
  await expect(targetRow).toHaveCount(0)
  await expectTotal(total, 1)
  expect(api.deletionRequests).toEqual([legacy.id, legacy.id])
  expect([...api.records.values()]).toEqual([remaining])
  await page.reload()
  await expectTotal(total, 1)
  await expect(targetRow).toHaveCount(0)
  await expect(editableRow(page, remaining)).toContainText('하남')
})
