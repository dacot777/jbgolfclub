import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  createBackup,
  exactViews,
  readBackup,
  recordReport,
  summarizePeriod,
  validateRecord,
  validDate,
  type InsightRecord,
} from '../src/lib/manual-insights'

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII='
const fixture = (overrides: Partial<InsightRecord> = {}): InsightRecord => ({
  id: 'test-1',
  adName: '검증 광고 A',
  account: 'jbgolfacademy',
  capturedOn: null,
  period: null,
  spend: 1000,
  views: '2만',
  reach: null,
  impressions: null,
  resultType: '프로필 방문',
  resultCount: 10,
  notes: '브라우저 테스트용 합성 기록',
  screenshot: null,
  createdAt: '2026-11-06T01:00:00Z',
  updatedAt: '2026-11-06T01:00:00Z',
  ...overrides,
})

test('반올림·누락·집계 기간·서로 다른 결과와 누적 캡처를 구분한다', () => {
  const period = { start: '2026-11-01', end: '2026-11-05' }
  const old = fixture({
    id: 'old',
    views: '100',
    spend: 50,
    period,
    resultCount: 1,
  })
  const current = fixture({ period, updatedAt: '2026-11-06T02:00:00Z' })
  const other = fixture({
    id: 'b',
    adName: '검증 광고 B',
    period,
    spend: 2000,
    views: '1,234',
    resultType: '웹사이트 방문',
    resultCount: 20,
  })
  const unknown = fixture({ id: 'unknown', spend: 999999 })
  const overlapping = fixture({
    id: 'overlap',
    period: { start: '2026-11-02', end: '2026-11-05' },
    spend: 999999,
  })
  const summary = summarizePeriod(
    [old, current, other, unknown, overlapping],
    period.start,
    period.end,
  )
  expect(summary.records.map((r) => r.id)).toEqual(['test-1', 'b'])
  expect(summary.spend).toBe(3000)
  expect(summary.views).toBeNull()
  expect(summary.results).toEqual([
    { type: '프로필 방문', count: 10 },
    { type: '웹사이트 방문', count: 20 },
  ])
  expect(exactViews('5,625')).toBe(5625)
  expect(exactViews('2만')).toBeNull()
  expect(exactViews('')).toBeNull()
  expect(exactViews('1,23')).toBeNull()
  expect(exactViews('0')).toBe(0)
  expect(
    summarizePeriod(
      [fixture({ period, spend: null, resultCount: null })],
      period.start,
      period.end,
    ).spend,
  ).toBeNull()
  expect(recordReport(unknown)).toContain(
    '주간·월간 실적으로 사용할 수 없습니다',
  )
  expect(recordReport(current)).toContain('조회수: 2만')
  expect(validDate('2026-02-30')).toBe(false)
  expect(() =>
    validateRecord(
      fixture({ period: { start: '2026-11-05', end: '2026-11-01' } }),
    ),
  ).toThrow('집계 시작일')
})

test('백업은 이미지·미확인 기간·0을 보존하고 잘못된 파일을 거절한다', () => {
  const records = [
    fixture({
      spend: 0,
      screenshot: {
        name: 'test.png',
        dataUrl: `data:image/png;base64,${image}`,
      },
    }),
  ]
  expect(readBackup(createBackup(records))).toEqual(records)
  expect(() => readBackup('{"records":[]}')).toThrow('백업 파일')
  expect(() => readBackup(createBackup([fixture(), fixture()]))).toThrow('중복')
  expect(() => validateRecord(fixture({ spend: -1 }))).toThrow('수치')
  expect(() =>
    validateRecord(
      fixture({
        screenshot: {
          name: 'bad.svg',
          dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=',
        },
      }),
    ),
  ).toThrow('이미지')
  expect(() =>
    validateRecord(fixture({ spend: Number.POSITIVE_INFINITY })),
  ).toThrow('수치')
  expect(() =>
    readBackup(
      createBackup([fixture({ account: 'other' as 'jbgolfacademy' })]),
    ),
  ).toThrow('수치')
})

test('캡처 저장·새로고침·수정·보고 복사·삭제·백업 복원을 실제 브라우저에서 수행한다', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const errors: string[] = []
  const sent: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (r.method() === 'POST') sent.push(r.postData() ?? '')
  })
  await page.goto('/#records')
  await expect(
    page.getByRole('heading', { name: '인사이트 기록.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '캡처 기록 추가' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('광고 구분 이름').fill('검증 광고 A')
  await dialog.getByLabel('지출 (원)', { exact: true }).fill('1000')
  await dialog.getByLabel('조회수 (화면 표시 그대로)').fill('2만')
  await dialog.getByLabel('결과 수 (회)').fill('10')
  await dialog
    .getByLabel('광고 인사이트 캡처', { exact: true })
    .setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from(image, 'base64'),
    })
  await expect(dialog.getByAltText('첨부한 광고 인사이트 원본')).toBeVisible()
  await dialog.getByRole('button', { name: '확인 후 저장' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.archive-record')).toContainText('기간 미확인')
  await expect(page.locator('.archive-record')).toContainText(
    '주간·월간 합계 제외',
  )
  await page.reload()
  await expect(page.locator('.archive-record')).toContainText('2만')
  await expect(page.locator('.archive-record img')).toBeVisible()
  await page.getByRole('button', { name: '보고 복사', exact: true }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '집계 기간이 확인되지 않아',
  )
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '백업 내보내기' }).click()
  const download = await downloading
  const backup = await readFile((await download.path())!, 'utf8')
  const original = readBackup(backup)[0]
  expect(original.screenshot?.dataUrl).toBe(`data:image/png;base64,${image}`)
  await page.getByRole('button', { name: '수정·캡처 보기' }).click()
  await dialog
    .getByLabel('인사이트 화면에서 시작일·종료일을 확인했어요')
    .check()
  await dialog.getByLabel('집계 시작일').fill('2026-11-01')
  await dialog.getByLabel('집계 종료일').fill('2026-11-05')
  await dialog.getByRole('button', { name: '확인 후 저장' }).click()
  await page
    .getByLabel('집계 기간', { exact: true })
    .selectOption('2026-11-01|2026-11-05')
  await expect(
    page.getByRole('region', { name: '선택 기간 요약' }),
  ).toContainText('합계 산출 불가')
  await page.getByRole('button', { name: '검증 광고 A 기록 삭제' }).click()
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(page.locator('.archive-record')).toHaveCount(1)
  await page.getByRole('button', { name: '검증 광고 A 기록 삭제' }).click()
  await dialog.getByRole('button', { name: '기록 삭제', exact: true }).click()
  await expect(page.locator('.archive-record')).toHaveCount(0)
  await page
    .getByLabel('인사이트 백업 파일')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backup),
    })
  await dialog.getByRole('button', { name: '기록 가져오기' }).click()
  await expect(page.locator('.archive-record')).toContainText('기간 미확인')
  await page.reload()
  await expect(page.locator('.archive-record img')).toBeVisible()
  expect(sent).toEqual([])
  expect(errors).toEqual([])
})

test('백업 가져오기는 확인 후 병합하고 동일 ID 덮어쓰기 취소를 허용한다', async ({
  page,
}) => {
  await page.goto('/#records')
  const input = page.getByLabel('인사이트 백업 파일')
  await expect(
    page.getByRole('button', { name: '백업 가져오기' }),
  ).toBeEnabled()
  const file = (records: InsightRecord[]) => ({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(createBackup(records)),
  })
  await input.setInputFiles(file([fixture()]))
  await page.getByRole('button', { name: '기록 가져오기', exact: true }).click()
  await expect(page.locator('.archive-record')).toHaveCount(1)
  await input.setInputFiles(
    file([
      fixture({ spend: 999 }),
      fixture({ id: 'test-2', adName: '광고 B' }),
    ]),
  )
  await expect(page.getByRole('dialog')).toContainText('같은 기록 ID 1건')
  await page.getByRole('button', { name: '취소', exact: true }).click()
  await expect(page.locator('.archive-record')).toHaveCount(1)
  await expect(page.locator('.archive-record')).toContainText('1,000원')
  await input.setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  })
  await expect(page.getByRole('alert')).toContainText(
    'JSON 백업 파일을 읽지 못했습니다',
  )
  await expect(page.locator('.archive-record')).toHaveCount(1)
})

test('저장소 실패를 성공으로 표시하지 않는다', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open: () => {
          throw new Error('저장소 접근 제한')
        },
      },
    }),
  )
  await page.goto('/#records')
  await expect(
    page.getByRole('heading', { name: '브라우저 저장소를 사용할 수 없습니다' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '캡처 기록 추가' }),
  ).toBeDisabled()
  await expect(
    page.getByRole('button', { name: '백업 가져오기' }),
  ).toBeDisabled()
})

for (const width of [375, 768, 1440]) {
  test(`수동 기록 화면 ${width}px에서 이미지와 폼이 넘치지 않고 탐색이 된다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/')
    await page.getByRole('link', { name: '인사이트 기록하기' }).click()
    await expect(
      page.getByRole('heading', { name: '인사이트 기록.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '캡처 기록 추가' }).first(),
    ).toBeEnabled()
    await page.screenshot({
      path: `/tmp/jbgolf-records-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.getByRole('button', { name: '캡처 기록 추가' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page
      .getByLabel('인사이트 화면에서 시작일·종료일을 확인했어요')
      .check()
    await page.screenshot({
      path: `/tmp/jbgolf-records-form-${width}.png`,
      fullPage: true,
    })
    expect(
      await page.evaluate(() => {
        const el = document.querySelector('[role=dialog]')!
        return el.scrollWidth <= el.clientWidth
      }),
    ).toBe(true)
    page.on('dialog', (dialog) => dialog.accept())
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('link', { name: '성과 대시보드' }).click()
    await expect(
      page.getByRole('heading', { name: '인스타그램 광고 성과.' }),
    ).toBeVisible()
    await page.goBack()
    await expect(
      page.getByRole('heading', { name: '인사이트 기록.' }),
    ).toBeVisible()
  })
}
