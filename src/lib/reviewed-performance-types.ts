/** Reviewed screenshot data, independent of Instagram authentication status. */
export const REVIEWED_METRIC_KEYS = [
  'spend',
  'profileVisits',
  'profileVisitCost',
  'websiteVisits',
  'websiteVisitCost',
  'views',
  'viewers',
  'postEngagements',
  'linkClicks',
  'likes',
  'video3s',
] as const

export type ReviewedMetricKey = (typeof REVIEWED_METRIC_KEYS)[number]
export type ReviewedMetrics = Record<ReviewedMetricKey, number | null>

export interface ReviewedAd {
  id: string
  title: string
  postUrl: string
  objective: string
  status: 'active' | 'paused' | 'unknown'
  schedule: {
    start: string
    end: string
    dailyBudget: number
    durationDays: number
  } | null
}

export interface ReviewedSnapshot {
  id: string
  adId: string
  period: { start: string; end: string } | null
  scope: 'selected_period' | 'lifetime'
  reportedDays: number | null
  metrics: ReviewedMetrics
  reviewedAt: string
  sourceLabel: string
  notes: string
}

export interface ReviewedPerformanceData {
  version: 1
  source: 'reviewed_screenshots'
  expectedAdCount: 2
  updatedAt: string | null
  ads: ReviewedAd[]
  snapshots: ReviewedSnapshot[]
}
