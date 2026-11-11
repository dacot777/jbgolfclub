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
}
export interface MetaAdsReport {
  status: 'unconfigured' | 'pending' | 'ready' | 'error'
  lastSyncedAt: string | null
  currency: string | null
  timeZone: string | null
  periods: MetaAdsPeriod[]
  daily: MetaAdsDaily[]
}
