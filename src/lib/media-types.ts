export const COMPANY_MEDIA_KEYWORDS = [
  'JB GOLF CLUB',
  'JB골프클럽',
  '제이비골프클럽',
  'JB골프클럽청담점',
  'JB골프클럽서현점',
  'JB아카데미',
  'JB골프아카데미',
  'JB GOLF ACADEMY',
  'JB ACADEMY',
] as const
export type MediaKind = 'news' | 'blog'
export type MediaItem = {
  id: string
  title: string
  url: string
  publisher: string
  author: string | null
  thumbnailUrl: string | null
  publishedAt: string | null
  firstSeenAt: string
  matchedKeywords: string[]
}
export type MediaFeed = {
  kind: MediaKind
  keywords: string[]
  items: MediaItem[]
  updatedAt: string | null
  checkedAt: string | null
  status: 'fresh' | 'partial' | 'cached' | 'unavailable'
  refreshing: boolean
  successfulQueries: number
  totalQueries: number
}
/** Public search result before storage; searchText is used only for relevance. */
export type MediaCandidate = Omit<MediaItem, 'id' | 'firstSeenAt'> & {
  searchText: string
}
