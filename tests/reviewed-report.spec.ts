import { test, expect } from '@playwright/test'
import {
  monthPeriods,
  periodKey,
  rowsForSelection,
  summarizeReviewed,
  previousPeriod,
  reviewedReport,
} from '../src/lib/reviewed-report'
import {
  REVIEWED_METRIC_KEYS,
  type ReviewedAd,
  type ReviewedMetrics,
  type ReviewedPerformanceData,
  type ReviewedSnapshot,
} from '../src/lib/reviewed-performance-types'

const ad = (id: string, title = `검증 광고 ${id}`): ReviewedAd => ({
  id,
  title,
  postUrl: 'https://www.instagram.com/p/TESTCODE/',
  objective: '프로필 방문',
  status: 'active',
  schedule: null,
})
const metrics = (overrides: Partial<ReviewedMetrics> = {}): ReviewedMetrics =>
  ({
    ...Object.fromEntries(REVIEWED_METRIC_KEYS.map((key) => [key, null])),
    ...overrides,
  }) as ReviewedMetrics
const period = { start: '2026-11-01', end: '2026-11-07' }
const snapshot = (
  overrides: Partial<ReviewedSnapshot> = {},
): ReviewedSnapshot => ({
  id: 's1',
  adId: 'a',
  period,
  scope: 'selected_period',
  reportedDays: 7,
  metrics: metrics({
    spend: 700,
    views: 70,
    viewers: 45,
    profileVisits: 7,
    profileVisitCost: 100,
    linkClicks: 5,
  }),
  reviewedAt: '2026-11-08T00:00:00Z',
  sourceLabel: '검증용 합성 캡처',
  notes: '',
  ...overrides,
})
const data = (snapshots: ReviewedSnapshot[]): ReviewedPerformanceData => ({
  version: 1,
  source: 'reviewed_screenshots',
  expectedAdCount: 2,
  updatedAt: null,
  ads: [ad('a'), ad('b')],
  snapshots,
})

test('월 기준 7일 구간과 월말 잔여일을 구분하고 윤년과 잘못된 달을 처리한다', () => {
  const november = monthPeriods('2026-11')
  expect(
    november.map(({ start, end, days }) => ({ start, end, days })),
  ).toEqual([
    { start: '2026-11-01', end: '2026-11-07', days: 7 },
    { start: '2026-11-08', end: '2026-11-14', days: 7 },
    { start: '2026-11-15', end: '2026-11-21', days: 7 },
    { start: '2026-11-22', end: '2026-11-28', days: 7 },
    { start: '2026-11-29', end: '2026-11-30', days: 2 },
  ])
  expect(november[4].label).toContain('월말 · 2일')
  expect(monthPeriods('2024-02').at(-1)?.days).toBe(1)
  expect(monthPeriods('2025-02')).toHaveLength(4)
  expect(monthPeriods('2026-12').at(-1)?.end).toBe('2026-12-31')
  expect(monthPeriods('2026-13')).toEqual([])
  expect(monthPeriods('2026-1')).toEqual([])
  expect(monthPeriods('0000-01')).toEqual([])
})

test('같은 날짜의 최신 검토본만 선택하며 과거 주와 누적 캡처는 섞지 않는다', () => {
  const old = snapshot({
    id: 'old',
    reviewedAt: '2026-11-07T23:00:00Z',
    metrics: metrics({ spend: 500 }),
  })
  const corrected = snapshot({ id: 'corrected' })
  const nextWeek = snapshot({
    id: 'next',
    period: { start: '2026-11-08', end: '2026-11-14' },
    reviewedAt: '2026-11-17T00:00:00Z',
    metrics: metrics({ spend: 1400 }),
  })
  const lifetime = snapshot({
    id: 'lifetime',
    scope: 'lifetime',
    reviewedAt: '2026-11-16T00:00:00Z',
    metrics: metrics({ spend: 9999 }),
  })
  const unknown = snapshot({
    id: 'unknown',
    adId: 'b',
    period: null,
    scope: 'lifetime',
    reportedDays: 7,
  })
  const unrelated = snapshot({
    id: 'orphan',
    adId: 'not-a-real-ad',
    metrics: metrics({ spend: 999999 }),
  })
  const input = data([old, corrected, nextWeek, lifetime, unknown, unrelated])
  expect(
    rowsForSelection(input, periodKey(period)).map((row) => row.id),
  ).toEqual(['corrected'])
  expect(
    rowsForSelection(input, '2026-11-08|2026-11-14').map((row) => row.id),
  ).toEqual(['next'])
  expect(rowsForSelection(input, 'latest').map((row) => row.id)).toEqual([
    'lifetime',
    'unknown',
  ])
  expect(rowsForSelection(input, '2026-11-01|2026-11-08')).toEqual([])
  expect(rowsForSelection(input, '2026-02-30|2026-03-01')).toEqual([])
  expect(input.snapshots).toHaveLength(6)
})

test('시각대가 달라도 실제 누적 검토 시각을 비교하고 같은 광고의 중복 합계를 막는다', () => {
  const later = snapshot({
    id: 'utc',
    scope: 'lifetime',
    reviewedAt: '2026-11-08T01:00:00Z',
  })
  const earlier = snapshot({
    id: 'kst',
    scope: 'lifetime',
    reviewedAt: '2026-11-08T09:30:00+09:00',
    metrics: metrics({ spend: 99 }),
  })
  expect(rowsForSelection(data([later, earlier]), 'latest')[0].id).toBe('utc')
  expect(summarizeReviewed([earlier, later]).metrics.spend).toBe(700)
})

test('확인된 같은 기간의 가산값만 더하고 고유 인원·목표별 비용·누락을 보존한다', () => {
  const a = snapshot({
    metrics: metrics({
      spend: 0,
      views: 0,
      viewers: 20,
      profileVisits: 0,
      websiteVisits: 0,
      profileVisitCost: 0,
      linkClicks: 0,
    }),
  })
  const b = snapshot({
    id: 'b',
    adId: 'b',
    metrics: metrics({
      spend: 300,
      views: 50,
      viewers: 20,
      profileVisits: 3,
      websiteVisits: 0,
      profileVisitCost: 100,
      linkClicks: null,
    }),
  })
  const summary = summarizeReviewed([a, b])
  expect(summary.canAggregate).toBe(true)
  expect(summary.adCount).toBe(2)
  expect(summary.metrics.spend).toBe(300)
  expect(summary.metrics.views).toBe(50)
  expect(summary.metrics.profileVisits).toBe(3)
  expect(summary.metrics.websiteVisits).toBe(0)
  expect(summary.metrics.linkClicks).toBeNull()
  expect(summary.metrics.viewers).toBeNull()
  expect(summary.metrics.profileVisitCost).toBeNull()
  expect(summarizeReviewed([a]).metrics.profileVisitCost).toBe(0)
  expect(summarizeReviewed([]).metrics.spend).toBeNull()
  const missingDate = snapshot({
    id: 'unknown',
    adId: 'b',
    period: null,
    scope: 'lifetime',
  })
  expect(summarizeReviewed([a, missingDate]).canAggregate).toBe(false)
  expect(summarizeReviewed([a, missingDate]).metrics.spend).toBeNull()
  const different = snapshot({
    id: 'different',
    adId: 'b',
    period: { start: '2026-11-02', end: '2026-11-08' },
  })
  expect(summarizeReviewed([a, different]).canAggregate).toBe(false)
  expect(
    summarizeReviewed([
      { ...a, metrics: metrics({ spend: 1 }) },
      snapshot({
        id: 'huge',
        adId: 'b',
        metrics: metrics({ spend: Number.MAX_SAFE_INTEGER }),
      }),
    ]).metrics.spend,
  ).toBeNull()
})

test('직전 비교 기간은 연말·월 경계를 넘어 같은 일수로 계산한다', () => {
  expect(previousPeriod('2026-11-01|2026-11-07')).toEqual({
    key: '2026-10-25|2026-10-31',
    label: '2026-10-25 — 2026-10-31',
    start: '2026-10-25',
    end: '2026-10-31',
    days: 7,
  })
  expect(previousPeriod('2027-01-01|2027-01-07')?.key).toBe(
    '2026-12-25|2026-12-31',
  )
  expect(previousPeriod('2026-11-29|2026-11-30')?.days).toBe(2)
  expect(previousPeriod('latest')).toBeNull()
  expect(previousPeriod('2026-11-07|2026-11-01')).toBeNull()
})

test('보고 문장은 원문 지표와 각각의 목표를 보존하고 날짜 미확인·부분 자료를 명시한다', () => {
  const profile = snapshot({ period: null, scope: 'lifetime' })
  const website = snapshot({
    id: 'web',
    adId: 'b',
    period: null,
    scope: 'lifetime',
    metrics: metrics({
      spend: 200,
      websiteVisits: 4,
      websiteVisitCost: 50,
      views: 25,
      viewers: 20,
      linkClicks: 3,
    }),
  })
  const profileReport = reviewedReport(
    [ad('a')],
    [profile],
    '최근 전달 캡처',
    2,
  )
  expect(profileReport).toContain('확인된 광고 1/2개 기준')
  expect(profileReport).toContain('전체 기간 누적 (집계 날짜 확인 중)')
  expect(profileReport).toContain('프로필 방문 7회')
  expect(profileReport).toContain('화면의 프로필 방문당 비용 100원')
  expect(profileReport).toContain('주간·월간 실적으로 분류하지 않았습니다')
  const report = reviewedReport(
    [ad('a'), ad('b')],
    [profile, website],
    '최근 전달 캡처',
    2,
  )
  expect(report).toContain('웹사이트 방문 4회')
  expect(report).toContain('조회수 25회, 조회한 사람 20명, 링크 클릭 3회')
  expect(report).toContain('여러 광고의 수치를 합산하지 않았습니다')
  expect(report).toContain('자동으로 수집·갱신한 값이 아닙니다')
  expect(report).not.toContain('노출')
  expect(report).not.toContain('도달')
  expect(report).not.toContain('CTR')
  expect(reviewedReport([], [], '11월 1주', 2)).toContain(
    '확인된 성과 자료가 아직 없습니다',
  )
})
