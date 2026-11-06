import {
  REVIEWED_METRIC_KEYS,
  type ReviewedAd,
  type ReviewedMetricKey,
  type ReviewedMetrics,
  type ReviewedPerformanceData,
  type ReviewedSnapshot,
} from './reviewed-performance-types'

export type PeriodOption = {
  key: string
  label: string
  start: string
  end: string
  days: number
}

const DAY = 86_400_000
const dateOnly = (value: Date) => value.toISOString().slice(0, 10)

function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    dateOnly(new Date(value)) === value
  )
}

export function periodKey(period: { start: string; end: string }) {
  return `${period.start}|${period.end}`
}

function readPeriod(key: string) {
  const parts = key.split('|')
  if (parts.length !== 2) return null
  const [start, end] = parts
  if (!validDate(start) || !validDate(end) || start > end) return null
  return { start, end }
}

/** Calendar-month slots; the final slot is explicitly shorter than a week. */
export function monthPeriods(month: string): PeriodOption[] {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    Number(month.slice(0, 4)) < 1000
  )
    return []
  const last = new Date(`${month}-01T00:00:00Z`)
  last.setUTCMonth(last.getUTCMonth() + 1, 0)
  const lastDay = last.getUTCDate()
  const monthNumber = Number(month.slice(5))
  return [1, 8, 15, 22, 29]
    .filter((start) => start <= lastDay)
    .map((start, index) => {
      const end = Math.min(start + 6, lastDay)
      const period = {
        start: `${month}-${String(start).padStart(2, '0')}`,
        end: `${month}-${String(end).padStart(2, '0')}`,
      }
      const days = end - start + 1
      return {
        ...period,
        key: periodKey(period),
        days,
        label:
          days === 7
            ? `${monthNumber}월 ${index + 1}주 · ${start}~${end}일`
            : `${monthNumber}월 월말 · ${days}일 (${start}~${end}일)`,
      }
    })
}

function latestPerAd(rows: ReviewedSnapshot[]) {
  const latest = new Map<string, ReviewedSnapshot>()
  for (const row of rows) {
    const previous = latest.get(row.adId)
    const time = Date.parse(row.reviewedAt)
    const previousTime = previous ? Date.parse(previous.reviewedAt) : -Infinity
    if (
      !previous ||
      time > previousTime ||
      (time === previousTime && row.id > previous.id)
    ) {
      latest.set(row.adId, row)
    }
  }
  return [...latest.values()]
}

/** Select exact confirmed dates only. Lifetime snapshots never become weekly data. */
export function rowsForSelection(data: ReviewedPerformanceData, key: string) {
  const knownAdIds = new Set(data.ads.map((ad) => ad.id))
  const known = data.snapshots.filter((row) => knownAdIds.has(row.adId))
  if (key === 'latest') return latestPerAd(known)
  const period = readPeriod(key)
  if (!period) return []
  return latestPerAd(
    known.filter(
      (row) =>
        row.scope === 'selected_period' &&
        row.period?.start === period.start &&
        row.period.end === period.end,
    ),
  )
}

function emptyMetrics(): ReviewedMetrics {
  return Object.fromEntries(
    REVIEWED_METRIC_KEYS.map((key) => [key, null]),
  ) as ReviewedMetrics
}

export function summarizeReviewed(rows: ReviewedSnapshot[]): {
  metrics: ReviewedMetrics
  canAggregate: boolean
  adCount: number
} {
  const selected = latestPerAd(rows)
  const adCount = selected.length
  if (!adCount) return { metrics: emptyMetrics(), canAggregate: false, adCount }
  if (adCount === 1)
    return { metrics: { ...selected[0].metrics }, canAggregate: true, adCount }
  const first = selected[0]
  const canAggregate =
    first.scope === 'selected_period' &&
    !!first.period &&
    selected.every(
      (row) =>
        row.scope === 'selected_period' &&
        row.period?.start === first.period!.start &&
        row.period.end === first.period!.end,
    )
  const metrics = emptyMetrics()
  if (!canAggregate) return { metrics, canAggregate, adCount }
  const additive: ReviewedMetricKey[] = [
    'spend',
    'profileVisits',
    'websiteVisits',
    'views',
    'postEngagements',
    'linkClicks',
    'likes',
    'video3s',
  ]
  for (const key of additive) {
    const values = selected.map((row) => row.metrics[key])
    if (values.every((value) => value !== null)) {
      const sum = values.reduce<number>(
        (total, value) => total + (value ?? 0),
        0,
      )
      metrics[key] = Number.isSafeInteger(sum) ? sum : null
    }
  }
  // A viewer can occur in more than one ad, and per-result costs are not additive.
  return { metrics, canAggregate, adCount }
}

export function previousPeriod(key: string): PeriodOption | null {
  const period = readPeriod(key)
  if (!period) return null
  const startMs = Date.parse(period.start)
  const days = Math.round((Date.parse(period.end) - startMs) / DAY) + 1
  const previousStart = new Date(startMs - days * DAY)
  const previousEnd = new Date(startMs - DAY)
  const start = dateOnly(previousStart)
  const end = dateOnly(previousEnd)
  if (!validDate(start) || !validDate(end)) return null
  return {
    key: periodKey({ start, end }),
    label: `${start} — ${end}`,
    start,
    end,
    days,
  }
}

const numeric = (value: number) => value.toLocaleString('ko-KR')
const metric = (value: number | null, suffix: string) =>
  value === null ? '자료 없음' : `${numeric(value)}${suffix}`

/** Facts-only copy: keeps each objective and screenshot's metric names separate. */
export function reviewedReport(
  ads: ReviewedAd[],
  rows: ReviewedSnapshot[],
  selectionLabel: string,
  expectedCount: number,
) {
  const selected = latestPerAd(rows)
  const lines = [
    '[캡처 확인 자료 · 자동 연동 전]',
    `조회 기준: ${selectionLabel}`,
  ]
  if (!selected.length) {
    lines.push(
      '이 기간에 확인된 성과 자료가 아직 없습니다. 미제공 값을 0으로 표시하지 않습니다.',
    )
    return lines.join('\n')
  }
  lines.push(
    `확인된 광고 ${selected.length}/${expectedCount}개 기준이며, 계정 전체 광고 합계가 아닙니다.`,
  )
  for (const row of selected) {
    const title =
      ads.find((ad) => ad.id === row.adId)?.title ?? '광고 이름 미확인'
    const m = row.metrics
    const period = row.period
      ? `${row.period.start} — ${row.period.end}`
      : '집계 날짜 확인 중'
    const scope = row.scope === 'lifetime' ? '전체 기간 누적' : '선택 기간'
    const results: string[] = []
    if (m.profileVisits !== null) {
      results.push(`프로필 방문 ${metric(m.profileVisits, '회')}`)
      if (m.profileVisitCost !== null)
        results.push(
          `화면의 프로필 방문당 비용 ${metric(m.profileVisitCost, '원')}`,
        )
    }
    if (m.websiteVisits !== null) {
      results.push(`웹사이트 방문 ${metric(m.websiteVisits, '회')}`)
      if (m.websiteVisitCost !== null)
        results.push(
          `화면의 웹사이트 방문당 비용 ${metric(m.websiteVisitCost, '원')}`,
        )
    }
    results.push(
      `조회수 ${metric(m.views, '회')}`,
      `조회한 사람 ${metric(m.viewers, '명')}`,
      `링크 클릭 ${metric(m.linkClicks, '회')}`,
    )
    lines.push(
      `${title} · ${scope} (${period}): 광고비 ${metric(m.spend, '원')}, ${results.join(', ')}.`,
    )
  }
  if (selected.some((row) => !row.period))
    lines.push(
      '집계 날짜가 확인되지 않은 누적 자료는 주간·월간 실적으로 분류하지 않았습니다.',
    )
  if (!summarizeReviewed(selected).canAggregate && selected.length > 1) {
    lines.push(
      '광고별 집계 기준이 같지 않아 여러 광고의 수치를 합산하지 않았습니다.',
    )
  }
  lines.push(
    '사용자가 전달한 캡처를 확인해 반영한 자료이며, 자동으로 수집·갱신한 값이 아닙니다.',
  )
  return lines.join('\n')
}
