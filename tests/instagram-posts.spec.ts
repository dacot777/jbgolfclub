import { expect, test, type Page } from '@playwright/test'
import {
  CALENDAR_ACCOUNTS,
  type CalendarMonth,
  type CalendarPost,
} from '../src/lib/calendar-types'

test.use({ baseURL: 'http://127.0.0.1:5174' })

const month = '2026-11'
const photo = '/brand/jb-academy-shield.png'
const reel: CalendarPost = {
  account: 'jbgolfacademy',
  id: 'synthetic-gallery-clip',
  kind: 'reel',
  title: '확인된 연습 릴스',
  date: month + '-05',
  time: '18:26',
  thumbnailUrl: photo,
  permalink: 'https://www.instagram.com/reel/fixtureGalleryReel/',
}
const olderPost: CalendarPost = {
  ...reel,
  id: 'synthetic-prior-month',
  date: '2026-10-24',
  title: '지난달 연습 사진',
  kind: 'post',
  permalink: 'https://www.instagram.com/p/fixtureOlderPhoto/',
}

async function openGallery(page: Page, width: number, unavailable = false) {
  await page.setViewportSize({ width, height: 850 })
  await page.clock.setFixedTime(new Date(month + '-18T03:00:00Z'))
  await page.route('https://www.instagram.com/*/embed/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="ko"><body></body></html>',
    }),
  )
  await page.route('**/api/staff/session', (route) =>
    route.fulfill({ json: { authenticated: false } }),
  )
  await page.route('**/api/performance', (route) =>
    route.fulfill({
      json: {
        version: 1,
        source: 'reviewed_screenshots',
        ads: [
          {
            id: 'synthetic-report',
            title: '보고서 전용 샘플',
            postUrl: 'https://www.instagram.com/p/fixtureOnlyInReport/',
            thumbnailUrl: photo,
          },
        ],
        snapshots: [],
      },
    }),
  )
  await page.route('**/api/calendar/posts', (route) => {
    if (unavailable) return route.fulfill({ status: 503, json: {} })
    const data: CalendarMonth = {
      month: 'latest',
      accounts: CALENDAR_ACCOUNTS.map((account) => ({
        account,
        status: 'needs_connection',
        lastSyncedAt: null,
      })),
      posts: [olderPost, reel],
      schedules: [
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
          account: 'jbgolfacademy',
          kind: 'post',
          date: month + '-19',
          time: null,
          title: '아직 촬영 전인 일정',
          note: '',
        },
      ],
    }
    return route.fulfill({ json: data })
  })
  await page.goto('/#instagram-posts')
}

for (const width of [390, 1440]) {
  test(
    '계정·기간 선택 없이 세 계정의 공식 피드를 함께 본다 · ' + width + 'px',
    async ({ page }) => {
      await openGallery(page, width)
      const latest = page.getByRole('region', { name: '계정별 최신 피드' })
      await expect(page.getByText('전체 계정', { exact: true })).toBeVisible()
      await expect(
        page.getByRole('group', { name: '표시할 계정' }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', {
          name: /^(전체 계정|아카데미|골프클럽 공식|골프클럽 분당)$/,
        }),
      ).toHaveCount(0)
      const columns = latest.locator('.ig-account')
      await expect(columns).toHaveCount(3)
      for (const [index, account] of CALENDAR_ACCOUNTS.entries()) {
        const column = columns.nth(index)
        await expect(column.locator('iframe')).toHaveAttribute(
          'src',
          'https://www.instagram.com/' + account + '/embed/',
        )
        await expect(
          column.getByRole('link', { name: /게시물 \(새 창\)/ }),
        ).toHaveAttribute('href', 'https://www.instagram.com/' + account + '/')
      }
      const boxes = await columns.evaluateAll((elements) =>
        elements.map((el) => {
          const { top, left } = el.getBoundingClientRect()
          return { top, left }
        }),
      )
      if (width === 1440) {
        expect(boxes[0].top).toBe(boxes[2].top)
        expect(boxes[2].left).toBeGreaterThan(boxes[1].left)
      } else {
        expect(boxes[1].top).toBeGreaterThan(boxes[0].top)
      }
      await expect(columns.first().getByRole('listitem').first()).toContainText(
        reel.title,
      )
      await expect(columns.first().getByRole('listitem').last()).toContainText(
        olderPost.title,
      )
      await expect(
        columns.nth(1).getByRole('link', {
          name: '직접 등록한 연습 사진 Instagram에서 보기',
        }),
      ).toContainText('미리보기 없음')
      await expect(latest.getByText('아직 촬영 전인 일정')).toHaveCount(0)
      await expect(page.getByText('보고서 전용 샘플')).toHaveCount(0)
      await expect(
        latest.getByText('자동 수집 연결 전', { exact: false }),
      ).toHaveCount(0)
      await expect(
        page.getByRole('button', { name: /^(월별 보기|최신 피드)$/ }),
      ).toHaveCount(0)
      await expect(page.getByLabel('게시 월')).toHaveCount(0)
      await expect(
        latest.getByRole('link', { name: reel.title + ' Instagram에서 보기' }),
      ).toHaveAttribute('href', reel.permalink)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
    },
  )
}
test('저장소 오류 중에도 세 공식 프로필 미리보기와 원문 바로가기를 연다', async ({
  page,
}) => {
  await openGallery(page, 390, true)
  const latest = page.getByRole('region', { name: '계정별 최신 피드' })
  await expect(latest.getByRole('alert')).toContainText(
    '등록한 게시물을 불러오지 못했습니다.',
  )
  await expect(latest.locator('iframe')).toHaveCount(3)
  await expect(latest.getByRole('link', { name: /새 창/ })).toHaveCount(9)
})
