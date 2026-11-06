import {
  REVIEWED_METRIC_KEYS,
  type ReviewedMetricKey,
  type ReviewedMetrics,
  type ReviewedSnapshot,
} from './reviewed-performance-types'

const DAY = 86_400_000
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
] as const satisfies readonly ReviewedMetricKey[]

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

function validateSource(source: ReviewedSnapshot) {
  if (source.scope !== 'lifetime')
    throw new Error(
      '기간 증가분은 전체 누적 원본 두 건으로만 계산할 수 있습니다.',
    )
  if (
    !source.period ||
    !validDate(source.period.start) ||
    !validDate(source.period.end) ||
    source.period.start > source.period.end
  )
    throw new Error('누적 원본의 시작일과 종료일을 먼저 확인해 주세요.')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(source.id) || !source.adId)
    throw new Error('누적 원본의 식별자를 확인해 주세요.')
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      source.reviewedAt,
    ) ||
    !validDate(source.reviewedAt.slice(0, 10)) ||
    !Number.isFinite(Date.parse(source.reviewedAt))
  )
    throw new Error('누적 원본의 자료 확인 시각을 확인해 주세요.')
  for (const key of REVIEWED_METRIC_KEYS) {
    const value = source.metrics[key]
    if (value !== null && (!Number.isSafeInteger(value) || value! < 0))
      throw new Error(
        `${key}: 누적 원본의 수치는 0 이상의 정수 또는 미기록이어야 합니다.`,
      )
  }
}

/** Derives additive counter growth, never unique users or differences of costs. */
export function deriveIncrementalSnapshot(
  previous: ReviewedSnapshot,
  current: ReviewedSnapshot,
  id: string,
): ReviewedSnapshot & {
  basis: 'cumulative_difference'
  sourceSnapshotIds: string[]
} {
  validateSource(previous)
  validateSource(current)
  if (previous.adId !== current.adId)
    throw new Error('같은 광고의 누적 원본끼리 비교해야 합니다.')
  if (previous.period!.start !== current.period!.start)
    throw new Error('누적 집계 시작일이 달라 직접 차감할 수 없습니다.')
  if (current.period!.end <= previous.period!.end)
    throw new Error('새 누적 원본의 종료일은 이전 종료일보다 뒤여야 합니다.')
  if (Date.parse(current.reviewedAt) < Date.parse(previous.reviewedAt))
    throw new Error(
      '새 누적 원본의 자료 확인 시각이 이전보다 빠릅니다. 원본 순서를 확인해 주세요.',
    )
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(id) ||
    id === previous.id ||
    id === current.id ||
    previous.id === current.id
  )
    throw new Error('증가분에는 원본과 다른 새 식별자를 사용해 주세요.')

  const metrics = Object.fromEntries(
    REVIEWED_METRIC_KEYS.map((key) => [key, null]),
  ) as ReviewedMetrics
  for (const key of additive) {
    const before = previous.metrics[key]
    const after = current.metrics[key]
    if (before === null || after === null) continue
    if (after < before)
      throw new Error(
        `${key}: 새 누적값이 이전보다 작습니다. 원본 정정 여부를 확인한 뒤 수동 검토해 주세요.`,
      )
    metrics[key] = after - before
  }
  const cost = (result: number | null) =>
    metrics.spend === null || result === null || result === 0
      ? null
      : Math.round(metrics.spend / result)
  metrics.profileVisitCost = cost(metrics.profileVisits)
  metrics.websiteVisitCost = cost(metrics.websiteVisits)
  metrics.linkClickCost = cost(metrics.linkClicks)
  // Overlapping lifetime audiences cannot establish a period's unique viewers.
  metrics.viewers = null

  const start = new Date(Date.parse(previous.period!.end) + DAY)
    .toISOString()
    .slice(0, 10)
  const end = current.period!.end
  return {
    id,
    adId: current.adId,
    period: { start, end },
    scope: 'selected_period',
    reportedDays: Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1,
    metrics,
    reviewedAt: current.reviewedAt,
    sourceLabel: '누적 인사이트 차이로 계산한 기간 증가분',
    notes:
      '동일 광고와 동일 누적 시작일의 두 원본을 차감한 기간 증가분입니다. 조회한 사람은 기간 고유 인원을 계산할 수 없어 제외했습니다. 결과당 비용은 이 기간의 지출 증가분과 결과 증가분으로 다시 계산했습니다. 플랫폼에서 해당 기간을 직접 조회한 수치가 아닙니다.',
    basis: 'cumulative_difference',
    sourceSnapshotIds: [previous.id, current.id],
  }
}
