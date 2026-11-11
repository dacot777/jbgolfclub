import { test, expect } from '@playwright/test'
test.use({ baseURL: 'http://127.0.0.1:5174' })

test('로그인 화면은 인스타그램 전용이며 한 계정만 안내한다', async ({
  page,
}) => {
  await page.route('**/api/connection', (route) =>
    route.fulfill({
      json: {
        configured: true,
        authenticated: false,
        targetUsername: 'jb_test_single',
        connection: null,
        advertisingAccess: false,
      },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '계정 연결', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('@jb_test_single')
  const button = page.getByRole('button', {
    name: '인스타그램으로 로그인하여 연결',
  })
  await expect(button).toBeVisible()
  await expect(button.locator('..')).toHaveAttribute(
    'action',
    '/api/auth/instagram/start',
  )
  await expect(button.locator('..')).toHaveAttribute('method', 'post')
  await expect(page.getByRole('dialog')).toContainText(
    '인스타그램 로그인만으로 광고비 조회 권한이 생기지는 않습니다.',
  )
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('프로필 연결을 광고 연동으로 표시하지 않으며 보호된 연결 해제를 요청한다', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 })
  let disconnected = false
  await page.route('**/api/connection', async (route) => {
    if (route.request().method() === 'DELETE') {
      expect(route.request().headers()['x-csrf-token']).toBe('test-only-csrf')
      disconnected = true
      await route.fulfill({ json: { disconnected: true } })
      return
    }
    await route.fulfill({
      json: disconnected
        ? {
            configured: true,
            authenticated: false,
            connection: null,
            advertisingAccess: false,
          }
        : {
            configured: true,
            authenticated: true,
            csrfToken: 'test-only-csrf',
            advertisingAccess: false,
            connection: {
              username: 'jb_test_single',
              userId: '178414123456789',
              connectedAt: Date.now(),
              tokenExpiresAt: Date.now() + 86400000,
              needsReconnect: false,
              refreshWarning: false,
            },
          },
    })
  })
  await page.goto('/')
  await expect(
    page.getByText('Instagram 프로필 연결됨', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.metric-card').first()).toContainText('—')
  await expect(page.locator('.metric-card').first()).not.toContainText(
    '864,500',
  )
  await page.getByRole('button', { name: '계정 연결', exact: true }).click()
  await expect(page.locator('.connection-facts')).toContainText(
    '광고 자동 보고서',
  )
  await page.getByRole('button', { name: '연결 해제', exact: true }).click()
  await expect(page.locator('.disconnect-confirm')).toBeVisible()
  await page.getByRole('button', { name: '연결 해제', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '인스타그램으로 로그인하여 연결' }),
  ).toBeVisible()
  expect(disconnected).toBe(true)
})

test('주소의 성공 표시만으로 연결됐다고 주장하지 않는다', async ({ page }) => {
  await page.route('**/api/connection', (route) =>
    route.fulfill({
      json: {
        configured: true,
        authenticated: false,
        connection: null,
        advertisingAccess: false,
      },
    }),
  )
  await page.goto('/?instagram_connected=1')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Instagram 계정 미연결')).toBeVisible()
  await expect(
    page.getByText('Instagram 프로필 연결됨', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '인스타그램으로 로그인하여 연결' }),
  ).toBeVisible()
})

test('상태 조회 실패를 연결 성공으로 바꾸지 않는다', async ({ page }) => {
  await page.route('**/api/connection', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'unavailable' } } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '계정 연결', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    '연결 상태를 확인하지 못했습니다.',
  )
  await expect(page.getByRole('button', { name: '다시 확인' })).toBeVisible()
  await expect(
    page.getByText('Instagram 프로필 연결됨', { exact: true }),
  ).toHaveCount(0)
})
