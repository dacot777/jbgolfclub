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
  'linkClickCost',
  'landingPageViews',
  'likes',
  'video3s',
] as const

export type ReviewedMetricKey = (typeof REVIEWED_METRIC_KEYS)[number]
export type ReviewedMetrics = Record<ReviewedMetricKey, number | null>

export interface ReviewedAd {
  id: string
  title: string
  postUrl: string
  thumbnailUrl?: string | null
  objective: string
  status: 'active' | 'paused' | 'unknown'
  schedule: {
    start: string
    end: string
    dailyBudget: number | null
    totalBudget?: number | null
    durationDays: number
  } | null
  targeting?: {
    locations: string[]
    ageMin: number
    ageMax: number
    interests: string[]
    locationOptimization: boolean | null
    advantageDetailedTargeting: boolean | null
    advantageAudience: boolean | null
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
  basis?: 'screenshot' | 'user_assigned' | 'cumulative_difference'
  sourceSnapshotIds?: string[]
  commentary?: string | null
}

export interface ReviewedPerformanceData {
  version: 1
  source: 'reviewed_screenshots'
  expectedAdCount: 2
  updatedAt: string | null
  ads: ReviewedAd[]
  snapshots: ReviewedSnapshot[]
}
