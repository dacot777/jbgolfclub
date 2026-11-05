export type MetricKey = 'spend' | 'reach' | 'impressions' | 'clicks'
export type Summary = Record<MetricKey, number>
export type Result = {
  name: string
  type: string
  count: number
  spend: number
  unit: string
}
export type AdRow = {
  id: string
  name: string
  brand: string
  objective: string
  spend: number
  reach: number
  impressions: number
  clicks: number
  result: number
}
export const number = (value: number) =>
  new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value)
export const won = (value: number) => `${number(value)}원`
export function difference(current: number, previous?: number) {
  if (previous === undefined) return { amount: null, percent: null }
  const amount = current - previous
  return { amount, percent: previous === 0 ? null : (amount / previous) * 100 }
}
export function changeLabel(current: number, previous?: number, unit = '') {
  const { amount, percent } = difference(current, previous)
  if (amount === null) return '비교 자료 없음'
  const absolute = `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${number(Math.abs(amount))}${unit}`
  return percent === null
    ? absolute
    : `${absolute} (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`
}
export function costPerResult(result: Result) {
  return result.count === 0 ? null : result.spend / result.count
}
export function periods(asOf: string) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(asOf))
  const end = new Date(`${day}T00:00:00Z`)
  const monday = new Date(end)
  monday.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7))
  const previousStart = new Date(monday)
  previousStart.setUTCDate(monday.getUTCDate() - 7)
  const previousEnd = new Date(end)
  previousEnd.setUTCDate(end.getUTCDate() - 7)
  const date = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '.')
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(asOf))
  return {
    current: `${date(monday)} — ${date(end)}`,
    previous: `${date(previousStart)} — ${date(previousEnd)}`,
    month: `${day.slice(0, 7).replace('-', '.')}.01 — ${date(end)}`,
    time,
  }
}
export function weeklyReport(
  current: Summary,
  previous: Summary | undefined,
  results: Result[],
  month: Summary,
  monthResults: Result[],
) {
  const labels: Record<MetricKey, string> = {
    spend: '광고비',
    reach: '도달',
    impressions: '노출',
    clicks: '링크 클릭',
  }
  const units: Record<MetricKey, string> = {
    spend: '원',
    reach: '명',
    impressions: '회',
    clicks: '회',
  }
  const changes = (Object.keys(labels) as MetricKey[]).map((key) => ({
    key,
    ...difference(current[key], previous?.[key]),
  }))
  const strongest = changes
    .filter((x) => x.percent !== null)
    .sort((a, b) => Math.abs(b.percent!) - Math.abs(a.percent!))[0]
  const comparison =
    strongest && previous
      ? `지난주 같은 집계 시점 대비 ${labels[strongest.key]}${strongest.key === 'spend' ? '는' : '은'} ${number(previous[strongest.key])}${units[strongest.key]}에서 ${number(current[strongest.key])}${units[strongest.key]}로 ${number(Math.abs(strongest.amount!))}${units[strongest.key]}(${Math.abs(strongest.percent!).toFixed(1)}%) ${strongest.amount! >= 0 ? '증가' : '감소'}했습니다.`
      : previous
        ? `지난주 같은 집계 시점 대비 광고비 증감은 ${changeLabel(current.spend, previous.spend, '원')}입니다.`
        : '지난주 같은 기간의 비교 자료가 없습니다.'
  const describe = (items: Result[]) =>
    items.map((r) => `${r.name} 목표 ${number(r.count)}${r.unit}`).join(', ')
  return `이번 주 인스타그램 광고비는 ${won(current.spend)}이며, 캠페인 목표별 결과는 ${describe(results)}입니다.\n${comparison}\n이번 달 누적 광고비는 ${won(month.spend)}이며, 캠페인 목표별 누적 결과는 ${describe(monthResults)}입니다.`
}
