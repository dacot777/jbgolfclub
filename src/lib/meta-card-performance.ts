import { useEffect, useState } from 'react'
import type {
  MetaAdsMetrics,
  MetaLifetimeReport,
  PublicMetaAdsReport,
} from './meta-ads-types'

export interface CardMetrics extends MetaAdsMetrics {
  reach: number | null
}
export interface CardRange {
  key: string
  kind: 'week' | 'month'
  since: string
  until: string
  byCard: Map<string, CardMetrics>
}

export function cardRanges(
  report: PublicMetaAdsReport | null,
  ads: { id: string }[],
) {
  if (!report) return []
  const ids = new Set(ads.map((ad) => ad.id))
  const ranges = new Map<string, CardRange>()
  function range(kind: CardRange['kind'], since: string, until: string) {
    const key = `meta:${kind}:${since}:${until}`
    let entry = ranges.get(key)
    if (!entry) {
      entry = { key, kind, since, until, byCard: new Map() }
      ranges.set(key, entry)
    }
    return entry
  }
  for (const row of report.adPeriods ?? []) {
    if (ids.has(row.reviewedAdId))
      range(row.kind, row.since, row.until).byCard.set(row.reviewedAdId, row)
  }
  const order = { week: 0, month: 1 }
  return [...ranges.values()].sort(
    (a, b) =>
      order[a.kind] - order[b.kind] ||
      b.since.localeCompare(a.since) ||
      b.until.localeCompare(a.until),
  )
}

type Feed = PublicMetaAdsReport | MetaLifetimeReport
function useMetaFeed<T extends Feed>(
  enabled: boolean,
  path: string,
  interval: number,
  valid: (value: T) => boolean,
) {
  const [data, setData] = useState<T | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!__INSTAGRAM_BACKEND__ || !enabled) return
    const controller = new AbortController()
    let busy = false,
      lastRead = 0
    async function read() {
      if (
        busy ||
        controller.signal.aborted ||
        document.visibilityState === 'hidden'
      )
        return
      busy = true
      lastRead = Date.now()
      try {
        const response = await fetch(path, {
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(25000),
          ]),
        })
        if (!response.ok) throw new Error('unavailable')
        const value: T = await response.json()
        if (!valid(value)) throw new Error('invalid_report')
        if (!controller.signal.aborted) {
          setData(value)
          setFailed(false)
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      } finally {
        busy = false
      }
    }
    const onFocus = () => {
      if (Date.now() - lastRead >= Math.min(interval, 60000)) void read()
    }
    void read()
    const timer = window.setInterval(read, interval)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled, path, interval, valid])
  return { data, failed }
}
const reportShape = (r: PublicMetaAdsReport) =>
  Array.isArray(r.daily) && (!r.adPeriods || Array.isArray(r.adPeriods))
const lifetimeShape = (r: MetaLifetimeReport) => Array.isArray(r.totals)
export function useCardPerformance(enabled: boolean) {
  const history = useMetaFeed(enabled, '/api/meta-ads', 3600000, reportShape)
  const latest = useMetaFeed(
    enabled,
    '/api/meta-ads/lifetime',
    60000,
    lifetimeShape,
  )
  return {
    report: history.data,
    failed: history.failed,
    lifetime: latest.data,
    lifetimeFailed: latest.failed,
  }
}
