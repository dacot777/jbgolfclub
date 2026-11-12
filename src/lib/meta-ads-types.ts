export interface MetaAdsMetrics {
  spend: number | null
  impressions: number | null
  linkClicks: number | null
}
export interface MetaAdsPeriod extends MetaAdsMetrics {
  kind: 'week' | 'month'
  since: string
  until: string
  reach: number | null
}
export interface MetaAdsDaily extends MetaAdsMetrics {
  date: string
  adId: string
  adName: string
  reviewedAdId?: string
  reach?: number | null
}
export interface MetaCardPeriod extends MetaAdsPeriod {
  reviewedAdId: string
}
export type AdDeliveryStatus =
  | 'active'
  | 'paused'
  | 'scheduled'
  | 'archived'
  | 'inactive'
  | 'unknown'
export interface MetaAdCard {
  id: string
  title: string
  postUrl: string | null
  thumbnailUrl: string | null
  status: AdDeliveryStatus
  startAt?: string | null
  firstDeliveryDate?: string | null
  statusObservedAt?: string | null
  pauseEvents?: MetaPauseEvent[]
}
export interface MetaPauseEvent {
  at: string
  source: 'meta' | 'observed'
  previousActiveAt?: string | null
  lastDeliveryDate?: string | null
}
export interface MetaLifetimeRow extends MetaAdsMetrics {
  reviewedAdId: string
  reach: number | null
  since: string
  until: string
  complete: boolean
  asOf?: string | null
}
export interface MetaLifetimeReport {
  status: MetaAdsReport['status']
  asOf: string | null
  currency: string | null
  totals: MetaLifetimeRow[]
}
export interface MetaAdsReport {
  status: 'unconfigured' | 'pending' | 'ready' | 'error'
  lastSyncedAt: string | null
  currency: string | null
  timeZone: string | null
  periods: MetaAdsPeriod[]
  adPeriods?: MetaCardPeriod[]
  daily: MetaAdsDaily[]
}

export type PublicMetaAdsReport = Omit<MetaAdsReport, 'daily'> & {
  daily: Omit<MetaAdsDaily, 'adId'>[]
  cards?: MetaAdCard[]
}
