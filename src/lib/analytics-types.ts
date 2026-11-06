export const ANALYTICS_MENUS = [
  'overview',
  'campaigns',
  'news',
  'blog',
  'connection',
] as const
export type AnalyticsMenu = (typeof ANALYTICS_MENUS)[number]
export const ANALYTICS_MENU_NAMES: Record<AnalyticsMenu, string> = {
  overview: '성과 대시보드',
  campaigns: '광고 상세',
  news: '기사',
  blog: '블로그',
  connection: '계정 연결',
}
export type AnalyticsEvent = {
  visitId: string
  viewId: string
  menu: AnalyticsMenu
  seq: number
  phase: 'enter' | 'heartbeat' | 'pause' | 'resume' | 'leave'
  activeMs: number
}
export type AnalyticsView = {
  id: string
  menu: AnalyticsMenu
  enteredAt: string
  lastSeenAt: string
  endedAt: string | null
  activeMs: number
  active: boolean
}
export type AnalyticsVisit = {
  id: string
  visitorLabel: string
  startedAt: string
  lastSeenAt: string
  endedAt: string | null
  activeMs: number
  browser: string
  device: string
  status: 'active' | 'idle' | 'ended'
  views: AnalyticsView[]
}
export type AdminSession = {
  authenticated: boolean
  configured: boolean
  csrfToken?: string
}
export type AnalyticsReport = {
  days: 1 | 7 | 30
  page: number
  pageSize: number
  totalVisits: number
  totalVisitors: number
  totalActiveMs: number
  totalPages: number
  visits: AnalyticsVisit[]
  updatedAt: string
}
