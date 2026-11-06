import { test, expect } from '@playwright/test'
import { deriveIncrementalSnapshot } from '../src/lib/incremental-performance'
import {
  REVIEWED_METRIC_KEYS,
  type ReviewedMetrics,
  type ReviewedSnapshot,
} from '../src/lib/reviewed-performance-types'

const metrics = (overrides: Partial<ReviewedMetrics> = {}): ReviewedMetrics =>
  ({
    ...Object.fromEntries(REVIEWED_METRIC_KEYS.map((key) => [key, null])),
    ...overrides,
  }) as ReviewedMetrics
const source = (
  overrides: Partial<ReviewedSnapshot> = {},
): ReviewedSnapshot => ({
  id: 'old-cumulative',
  adId: 'synthetic-ad',
  scope: 'lifetime',
  period: { start: '2026-10-29', end: '2026-11-06' },
  reportedDays: 9,
  reviewedAt: '2026-11-06T09:00:00+09:00',
  sourceLabel: '합성 누적 원본',
  notes: '테스트 자료',
  metrics: metrics({
    spend: 1000,
    profileVisits: 10,
    profileVisitCost: 100,
    views: 100,
    viewers: 80,
    linkClicks: 5,
    linkClickCost: 200,
  }),
  ...overrides,
})
const current = (overrides: Partial<ReviewedSnapshot> = {}) =>
  source({
    id: 'new-cumulative',
    period: { start: '2026-10-29', end: '2026-11-13' },
    reviewedAt: '2026-11-13T09:00:00+09:00',
    reportedDays: 16,
    metrics: metrics({
      spend: 1450,
      profileVisits: 15,
      profileVisitCost: 97,
      views: 160,
      viewers: 110,
      linkClicks: 8,
      linkClickCost: 181,
    }),
    ...overrides,
  })

test('누적 원본을 보존하며 실제 날짜 사이의 증가분과 출처를 계산한다', () => {
  const previous = source({
    metrics: metrics({
      spend: 1000,
      profileVisits: 10,
      views: 100,
      viewers: 80,
      websiteVisits: 4,
      postEngagements: 12,
      linkClicks: 5,
      landingPageViews: 3,
      likes: 2,
      video3s: 1,
    }),
  })
  const next = current({
    metrics: metrics({
      spend: 1450,
      profileVisits: 15,
      views: 160,
      viewers: 110,
      websiteVisits: 6,
      postEngagements: 20,
      linkClicks: 8,
      landingPageViews: 5,
      likes: 2,
      video3s: 4,
    }),
  })
  const before = JSON.stringify([previous, next])
  Object.freeze(previous.period)
  Object.freeze(previous.metrics)
  Object.freeze(previous)
  Object.freeze(next.period)
  Object.freeze(next.metrics)
  Object.freeze(next)
  const result = deriveIncrementalSnapshot(previous, next, 'period-increment')
  expect(result.period).toEqual({ start: '2026-11-07', end: '2026-11-13' })
  expect(result.reportedDays).toBe(7)
  expect(result.scope).toBe('selected_period')
  expect(result.basis).toBe('cumulative_difference')
  expect(result.sourceSnapshotIds).toEqual(['old-cumulative', 'new-cumulative'])
  expect(result.reviewedAt).toBe(next.reviewedAt)
  expect(result.metrics).toEqual(
    metrics({
      spend: 450,
      profileVisits: 5,
      profileVisitCost: 90,
      websiteVisits: 2,
      websiteVisitCost: 225,
      views: 60,
      viewers: null,
      postEngagements: 8,
      linkClicks: 3,
      linkClickCost: 150,
      landingPageViews: 2,
      likes: 0,
      video3s: 3,
    }),
  )
  expect(result.notes).toContain('조회한 사람')
  expect(result.notes).toContain('직접 조회한 수치가 아닙니다')
  expect(JSON.stringify([previous, next])).toBe(before)
})

test('누락과 실제 0을 구분하고 분모가 없거나 0이면 비용을 만들지 않는다', () => {
  const previous = source({
    metrics: metrics({
      spend: 100,
      profileVisits: 2,
      views: 0,
      linkClicks: null,
      websiteVisits: 5,
    }),
  })
  const next = current({
    metrics: metrics({
      spend: 100,
      profileVisits: 2,
      views: 0,
      linkClicks: 4,
      websiteVisits: 6,
    }),
  })
  const result = deriveIncrementalSnapshot(previous, next, 'zeros')
  expect(result.metrics.spend).toBe(0)
  expect(result.metrics.views).toBe(0)
  expect(result.metrics.profileVisits).toBe(0)
  expect(result.metrics.profileVisitCost).toBeNull()
  expect(result.metrics.linkClicks).toBeNull()
  expect(result.metrics.linkClickCost).toBeNull()
  expect(result.metrics.websiteVisitCost).toBe(0)
  const noSpend = deriveIncrementalSnapshot(
    source({ metrics: metrics({ profileVisits: 1 }) }),
    current({ metrics: metrics({ spend: 200, profileVisits: 3 }) }),
    'no-spend',
  )
  expect(noSpend.metrics.spend).toBeNull()
  expect(noSpend.metrics.profileVisits).toBe(2)
  expect(noSpend.metrics.profileVisitCost).toBeNull()
})

test('원본 비용이나 고유 인원을 차감하지 않고 증가분 비용을 다시 계산한다', () => {
  const previous = source({
    metrics: metrics({
      spend: 1000,
      profileVisits: 10,
      profileVisitCost: 100,
      linkClicks: 5,
      linkClickCost: 200,
      viewers: 80,
    }),
  })
  const next = current({
    metrics: metrics({
      spend: 1450,
      profileVisits: 15,
      profileVisitCost: 97,
      linkClicks: 8,
      linkClickCost: 181,
      viewers: 70,
    }),
  })
  const result = deriveIncrementalSnapshot(previous, next, 'costs')
  expect(result.metrics.profileVisitCost).toBe(90)
  expect(result.metrics.linkClickCost).toBe(150)
  expect(result.metrics.viewers).toBeNull()
})

test('하나라도 줄어든 가산 누적값은 0으로 덮지 않고 원본 검토를 요구한다', () => {
  const additive = [
    'spend',
    'profileVisits',
    'websiteVisits',
    'views',
    'postEngagements',
    'linkClicks',
    'landingPageViews',
    'likes',
    'video3s',
  ] as const
  for (const key of additive) {
    const previous = source({ metrics: metrics({ [key]: 10 }) })
    const next = current({ metrics: metrics({ [key]: 9 }) })
    expect(() =>
      deriveIncrementalSnapshot(previous, next, 'decreased'),
    ).toThrow(`${key}: 새 누적값이 이전보다 작습니다`)
  }
})

test('서로 다른 광고·누적 시작점·기간 원본과 잘못된 순서의 차감을 막는다', () => {
  expect(() =>
    deriveIncrementalSnapshot(source(), current({ adId: 'other-ad' }), 'x'),
  ).toThrow('같은 광고')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ scope: 'selected_period' }),
      'x',
    ),
  ).toThrow('전체 누적 원본')
  expect(() =>
    deriveIncrementalSnapshot(
      source({ scope: 'selected_period' }),
      current(),
      'x',
    ),
  ).toThrow('전체 누적 원본')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ period: { start: '2026-11-01', end: '2026-11-13' } }),
      'x',
    ),
  ).toThrow('누적 집계 시작일')
  expect(() =>
    deriveIncrementalSnapshot(source({ period: null }), current(), 'x'),
  ).toThrow('시작일과 종료일')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ period: { start: '2026-10-29', end: '2026-11-06' } }),
      'x',
    ),
  ).toThrow('종료일보다 뒤')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ reviewedAt: '2026-11-05T00:00:00Z' }),
      'x',
    ),
  ).toThrow('확인 시각이 이전보다')
  expect(() =>
    deriveIncrementalSnapshot(source(), current(), 'old-cumulative'),
  ).toThrow('새 식별자')
  expect(() =>
    deriveIncrementalSnapshot(source(), current({ id: 'old-cumulative' }), 'x'),
  ).toThrow('새 식별자')
})

test('월말·연말·윤년과 7일이 아닌 간격도 실제 날짜에 맞춰 계산한다', () => {
  const periods = [
    {
      origin: '2026-12-01',
      previous: '2026-12-31',
      end: '2027-01-01',
      start: '2027-01-01',
      days: 1,
    },
    {
      origin: '2024-02-01',
      previous: '2024-02-28',
      end: '2024-03-01',
      start: '2024-02-29',
      days: 2,
    },
    {
      origin: '2026-10-29',
      previous: '2026-11-06',
      end: '2026-11-16',
      start: '2026-11-07',
      days: 10,
    },
  ]
  for (const p of periods) {
    const previous = source({
      period: { start: p.origin, end: p.previous },
      reviewedAt: `${p.previous}T09:00:00Z`,
    })
    const next = current({
      period: { start: p.origin, end: p.end },
      reviewedAt: `${p.end}T09:00:00Z`,
    })
    const result = deriveIncrementalSnapshot(previous, next, 'boundary')
    expect(result.period).toEqual({ start: p.start, end: p.end })
    expect(result.reportedDays).toBe(p.days)
  }
})

test('잘못된 날짜·시각·숫자를 실제 증가분으로 저장하지 않는다', () => {
  expect(() =>
    deriveIncrementalSnapshot(
      source({ period: { start: '2026-02-30', end: '2026-11-06' } }),
      current(),
      'x',
    ),
  ).toThrow('시작일과 종료일')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ reviewedAt: 'not-a-time' }),
      'x',
    ),
  ).toThrow('자료 확인 시각')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ reviewedAt: '2026-02-30T09:00:00Z' }),
      'x',
    ),
  ).toThrow('자료 확인 시각')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ metrics: metrics({ spend: 1.5 }) }),
      'x',
    ),
  ).toThrow('0 이상의 정수')
  expect(() =>
    deriveIncrementalSnapshot(
      source(),
      current({ metrics: metrics({ views: Number.POSITIVE_INFINITY }) }),
      'x',
    ),
  ).toThrow('0 이상의 정수')
  expect(() =>
    deriveIncrementalSnapshot(source(), current(), '../overwrite'),
  ).toThrow('새 식별자')
})
