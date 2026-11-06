import { useCallback, useEffect, useState } from 'react'
import type { ReviewedPerformanceData } from './reviewed-performance-types'

export function useReviewedPerformance() {
  const [data, setData] = useState<ReviewedPerformanceData | null>(null)
  const [loading, setLoading] = useState(__INSTAGRAM_BACKEND__)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    if (!__INSTAGRAM_BACKEND__) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/performance', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('performance_unavailable')
      const next = await response.json()
      if (
        next.version !== 1 ||
        next.source !== 'reviewed_screenshots' ||
        !Array.isArray(next.ads) ||
        !Array.isArray(next.snapshots)
      )
        throw new Error('invalid_performance')
      setData(next)
    } catch {
      setError(
        '확인된 광고 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      )
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { data, loading, error, reload }
}
