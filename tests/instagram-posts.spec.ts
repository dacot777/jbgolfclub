import { expect, test, type Page } from '@playwright/test'
import {
  CALENDAR_ACCOUNTS,
  type CalendarMonth,
  type CalendarPost,
} from '../src/lib/calendar-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })

const month = '2026-11'
const photo = '/brand/jb-academy-shield.png'
const academy = 'jbgolfacademy'
const reel: CalendarPost = {
  account: academy,
  id: 'synthetic-gallery-clip',
  kind: 'reel',
  title: '확인된 연습 릴스',
  date: month + '-05',
  time: '18:26',
  thumbnailUrl: photo,
  permalink: 'https://www.instagram.com/reel/fixtureGalleryReel/',
}
const ads = ['fixtureGalleryReel', 'fixtureGalleryReviewed'].map((code, i) => ({
  id: 'synthetic-ad-' + i,
  title: '원문 자료 ' + i,
  postUrl: 'https://www.instagram.com/' + academy + '/p/' + code + '/',
  thumbnailUrl: photo,
  objective: '',
  status: 'unknown',
  schedule: null,
}))
async function openGallery(page: Page, width: number) {
  await page.setViewportSize({ width, height: 850 })
  await page.clock.setFixedTime(new Date(month + '-18T03:00:00Z'))
  await page.route('**/api/staff/session', (route) =>
    route.fulfill({ json: { authenticated: false } }),
  )
  await page.route('**/api/performance', (route) =>
    route.fulfill({
      json: { version: 1, source: 'reviewed_screenshots', ads, snapshots: [] },
    }),
  )
  await page.route('**/api/calendar?*', (route) => {
    const selected = new URL(route.request().url()).searchParams.get('month')!
    const data: CalendarMonth = {
      month: selected,
      accounts: CALENDAR_ACCOUNTS.map((account) => ({
        account,
        status: 'needs_connection',
        lastSyncedAt: null,
      })),
      posts: selected === month ? [reel] : [],
      schedules:
        selected === month
          ? [
              {
                id: 'fixture-manual',
                version: 1,
                account: 'jbgolfclub_official',
                kind: 'post',
                date: month + '-16',
                time: null,
                title: '직접 등록한 연습 사진',
                note: '',
                permalink: 'https://www.instagram.com/p/fixtureGalleryPhoto/',
              },
              {
                id: 'fixture-plan',
                version: 1,
                account: academy,
                kind: 'post',
                date: month + '-19',
                time: null,
                title: '아직 촬영 전인 일정',
                note: '',
              },
            ]
          : [],
    }
    return route.fulfill({ json: data })
  })
  await page.goto('/#instagram-posts')
}

for (const width of [390, 1440]) {
  test(
    '공개 갤러리의 월·계정별 게시물과 광고 원문 구분 · ' + width + 'px',
    async ({ page }) => {
      await openGallery(page, width)
      await expect(
        page.getByRole('heading', {
          name: '인스타 게시물 모아보기',
          exact: true,
        }),
      ).toBeVisible()
      const feed = page.getByRole('region', { name: '2026년 11월 게시물·릴스' })
      await expect(feed.getByRole('listitem')).toHaveCount(2)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await expect(feed.getByRole('listitem').first()).toContainText(
        '직접 등록한 연습 사진',
      )
      await expect(feed.getByRole('listitem').first()).toContainText(
        '미리보기 없음',
      )
      const link = feed.getByRole('link', {
        name: reel.title + ' Instagram에서 보기',
      })
      await expect(link).toHaveAttribute('href', reel.permalink)
      await expect(link.locator('img')).toHaveAttribute('src', photo)
      await expect(link).toContainText('2026.11.05 18:26')
      await expect(page.getByText('아직 촬영 전인 일정')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '일정 등록' })).toHaveCount(
        0,
      )
      const archive = page.getByRole('region', {
        name: '광고 보고서에 저장된 게시물',
      })
      await expect(archive.getByRole('link')).toHaveCount(1)
      await expect(archive.getByRole('link').locator('img')).toBeVisible()
      await expect(archive.getByRole('link')).toHaveAttribute(
        'href',
        ads[1].postUrl,
      )
      const profiles = page.getByRole('navigation', {
        name: '계정별 게시물과 릴스 바로가기',
      })
      await expect(profiles.getByRole('link')).toHaveCount(9)
      await page
        .getByRole('button', { name: '골프클럽 공식', exact: true })
        .click()
      await expect(feed.getByRole('listitem')).toHaveCount(1)
      await expect(archive).toHaveCount(0)
      await expect(profiles.getByRole('link')).toHaveCount(3)
      await page.getByLabel('게시 월').fill('2026-10')
      await expect(
        page.getByRole('region', { name: '2026년 10월 게시물·릴스' }),
      ).toContainText('자동 수집 연결 전')
      await page.getByRole('button', { name: '전체 계정', exact: true }).click()
      await expect(archive.getByRole('link')).toHaveCount(2)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    },
  )
}
