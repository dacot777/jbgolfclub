import { test, expect, type Locator, type Page } from '@playwright/test'
import type { Inquiry, InquiryInput } from '../src/lib/inquiry-types'

test.use({ baseURL: 'http://127.0.0.1:5174', hasTouch: true })

const demoAd = { id: 'synthetic-published-card', title: '검증 캠프 광고' }
const sessionToken = 'synthetic-inquiry-session-csrf'
const deviceGrant = 'T'.repeat(43)

async function expectTotal(summary: Locator, count: number) {
  await expect(summary).toHaveText(
    new RegExp('^총 문의\\s*' + count + '\\s*건$'),
  )
}

async function mockWorkspace(page: Page, initiallySignedIn: boolean) {
  let signedIn = initiallySignedIn
  let grantUses = 0
  let reads = 0
  let analyticsEvents = 0
  const deletionRequests: string[] = []
  const records = new Map<string, Inquiry>()
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

test('공개 방문자는 비밀번호 입력 없이 담당자 기기 안내를 보고 연결된 기기에서만 문의를 읽는다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
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
  await expect(
    page.getByRole('button', { name: '연결 파일 선택' }),
  ).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '새 문의', exact: true }),
  ).toHaveCount(0)
  expect(api.reads()).toBe(0)
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
  await expectTotal(summary, 0)
  await page.getByRole('button', { name: '이 기기 연결 해제' }).click()
  await expect(
    page.getByRole('button', { name: '연결 파일 선택' }),
  ).toBeVisible()
  await expect(summary).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  expect(api.analyticsEvents()).toBe(0)
})

test('문의 화면에서 선택한 연결 파일의 사이트를 검증하고 같은 탭에서 문의를 연다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
  await page.goto('/#inquiries')
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
  await expect(page.getByRole('heading', { name: '문의 목록' })).toBeVisible()
  await expect(page).toHaveURL(/#inquiries$/)
  expect(api.grantUses()).toBe(1)
  expect(
    await page.evaluate(() => document.documentElement.innerText),
  ).not.toContain(deviceGrant)
})

test('다른 탭에서 담당자 연결을 마치거나 해제한 뒤 기존 문의 화면에서 확인된다', async ({
  page,
}) => {
  const api = await mockWorkspace(page, false)
  await page.goto('/#inquiries')
  const recheck = page.getByRole('button', { name: '연결 상태 다시 확인' })
  await expect(recheck).toBeVisible()
  api.setSignedIn(true)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const list = page.getByRole('heading', { name: '문의 목록' })
  await expect(list).toBeVisible()
  api.setSignedIn(false)
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange')),
  )
  await expect(list).toHaveCount(0)
  await expect(recheck).toBeVisible()
  api.setSignedIn(true)
  await recheck.click()
  await expect(list).toBeVisible()
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
      page.getByRole('button', { name: input.name + ' 수정', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('row', { name: new RegExp(input.name) }),
    ).toContainText(customerLabel)
  }
  const saved = [...api.records.values()]
  expect(saved).toHaveLength(2)
  expect(saved[0]).toMatchObject({ ...camp, version: 1 })
  expect(saved[1]).toMatchObject({ ...lesson, version: 1 })

  await page
    .getByRole('button', { name: camp.name + ' 수정', exact: true })
    .click()
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
  await page
    .getByRole('combobox', { name: '진행 상태', exact: true })
    .selectOption('completed')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect.poll(() => api.records.get(saved[0].id)?.version).toBe(2)
  expect(api.records.get(saved[0].id)).toMatchObject({
    ...camp,
    branch: 'cheongdam',
    assignee: 'kim_uihyeon',
    stage: 'completed',
  })
  expect(api.records.get(saved[1].id)).toMatchObject({ ...lesson, version: 1 })
  await expectTotal(page.getByLabel('전체 문의 현황'), 2)

  const beforeReload = api.reads()
  await page.reload()
  await expect.poll(() => api.reads()).toBeGreaterThan(beforeReload)
  await expect(
    page.getByRole('row').filter({ hasText: camp.name }),
  ).toContainText('청담')
  const adFilter = page.getByLabel('광고 필터', { exact: true })
  await adFilter.selectOption(demoAd.id)
  await expectTotal(page.getByLabel('선택한 조건의 문의 현황'), 1)
  await expect(
    page.getByRole('button', { name: lesson.name + ' 수정', exact: true }),
  ).toHaveCount(0)
  await adFilter.selectOption('')
  await page
    .getByLabel('담당자 필터', { exact: true })
    .selectOption('kim_uihyeon')
  await expect(
    page.getByRole('button', { name: camp.name + ' 수정', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: lesson.name + ' 수정', exact: true }),
  ).toHaveCount(0)
  const filteredSummary = page.getByLabel('선택한 조건의 문의 현황')
  await expectTotal(filteredSummary, 1)
  await page
    .getByLabel('담당자 필터', { exact: true })
    .selectOption('unassigned')
  await page.getByLabel('상품 필터', { exact: true }).selectOption('lesson')
  await expect(
    page.getByRole('button', { name: lesson.name + ' 수정', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: camp.name + ' 수정', exact: true }),
  ).toHaveCount(0)
  await expectTotal(filteredSummary, 1)
  await page
    .getByRole('button', { name: lesson.name + ' 수정', exact: true })
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
  const targetRow = page.getByRole('row').filter({ hasText: legacy.name })
  await expectTotal(total, 2)
  await expect(targetRow).toContainText('미지정')
  await targetRow
    .getByRole('button', { name: legacy.name + ' 수정', exact: true })
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
  await expect(targetRow).toContainText('주니어')
  await targetRow
    .getByRole('button', { name: legacy.name + ' 수정', exact: true })
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
    .getByRole('button', { name: legacy.name + ' 수정', exact: true })
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
  await expect(
    page.getByRole('row').filter({ hasText: remaining.name }),
  ).toContainText('하남')
})
