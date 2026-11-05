import { test, expect } from '@playwright/test'
import {
  difference,
  changeLabel,
  costPerResult,
  periods,
  weeklyReport,
} from '../src/lib/report'
import * as demo from '../src/lib/demo'

test('동일 요일·시간, 비교 자료 없음과 0, 목표별 비용을 구분한다', () => {
  expect(periods(demo.DEMO_AS_OF)).toEqual({
    current: '2026.11.02 — 2026.11.05',
    previous: '2026.10.26 — 2026.10.29',
    month: '2026.11.01 — 2026.11.05',
    time: '14:00',
  })
  expect(periods('2026-11-05T23:15:00Z').current).toBe(
    '2026.11.02 — 2026.11.06',
  )
  expect(changeLabel(10, undefined)).toBe('비교 자료 없음')
  expect(changeLabel(10, 0, '회')).toBe('+10회')
  expect(difference(0, 0)).toEqual({ amount: 0, percent: null })
  expect(costPerResult({ ...demo.results[0], count: 0 })).toBeNull()
  expect(costPerResult(demo.results[1])).toBe(452000 / 416)
  expect(demo.daily.reduce((n, d) => n + (d.spend ?? 0), 0)).toBe(
    demo.current.spend,
  )
  expect(demo.monthlyDaily.reduce((n, d) => n + d.spend, 0)).toBe(
    demo.month.spend,
  )
  const report = weeklyReport(
    demo.current,
    demo.previous,
    demo.results,
    demo.month,
    demo.monthResults,
  )
  expect(report).toContain('1,010회에서 1,248회로 238회(23.6%) 증가')
  expect(report).toContain('1,102,500원')
  expect(report).toContain('랜딩 페이지 조회 목표 548회')
})

test('미연결과 예시를 구분하고 같은 데이터로 보고·필터·CSV를 만든다', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto('/')
  await page.screenshot({ path: '/tmp/jbgolf-unconnected.png', fullPage: true })
  await expect(
    page.getByRole('heading', { name: '인스타그램 광고 성과.' }),
  ).toBeVisible()
  await expect(page.getByText('Instagram 계정 미연결')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '보고 문장 복사' }),
  ).toBeDisabled()
  await expect(page.getByText('864,500')).toHaveCount(0)
  await page.getByRole('button', { name: '예시 데이터 보기' }).click()
  await expect(page.locator('.metric-card').first()).toContainText('864,500')
  await expect(page.locator('.report-text')).toContainText(
    '1,010회에서 1,248회로',
  )
  await page.getByRole('button', { name: '보고 문장 복사' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '[예시 데이터 · 실제 보고에 사용하지 마세요]',
  )
  await page.getByRole('tab', { name: '광고', exact: true }).click()
  await page.getByLabel('브랜드 필터').selectOption('JB골프클럽')
  await page.getByRole('textbox', { name: '광고 이름 검색' }).fill('시설')
  await expect(page.locator('.detail-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.detail-table tbody')).toContainText(
    '시설 소개 릴스',
  )
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV 내보내기' }).click()
  expect((await download).suggestedFilename()).toContain('예시데이터_ad')
  await page.getByRole('button', { name: '예시 닫기' }).click()
  await expect(
    page.getByRole('button', { name: '보고 문장 복사' }),
  ).toBeDisabled()
  expect(errors).toEqual([])
})

for (const width of [375, 768, 1024, 1440]) {
  test(`폭 ${width}px에서 화면 넘침과 연결 안내를 확인한다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await page.getByRole('button', { name: '예시 데이터 보기' }).click()
    await expect(page.locator('.recharts-wrapper').first()).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    await page.screenshot({ path: `/tmp/jbgolf-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: '계정 연결', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText(
      '실제 계정 연결 기능은 아직 활성화되지 않았습니다.',
    )
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}
