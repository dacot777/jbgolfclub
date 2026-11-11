import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type {
  PublicMetaAdsReport as Report,
  MetaAdsPeriod as Period,
} from '@/lib/meta-ads-types'
import '@/meta-ads-report.css'

const metric = (value: number | null) =>
  value == null ? '미수집' : value.toLocaleString('ko-KR')
const dateLabel = (date: string) => date.replaceAll('-', '.')

function PeriodReport({
  kind,
  periods,
  spendLabel,
}: {
  kind: Period['kind']
  periods: Period[]
  spendLabel: (spend: number | null) => string
}) {
  const rows = periods
    .filter((row) => row.kind === kind)
    .sort((a, b) => b.since.localeCompare(a.since))
  if (!rows.length) return null
  const title = kind === 'week' ? '주간 실적' : '월간 실적'
  return (
    <Card className="meta-report-section">
      <h3>{title}</h3>
      <div
        className="meta-table-scroll"
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        <table>
          <caption className="sr-only">{title} 기간별 광고 성과</caption>
          <thead>
            <tr>
              <th scope="col">집계 기간</th>
              <th scope="col">광고비</th>
              <th scope="col">노출</th>
              <th scope="col">링크 클릭</th>
              <th scope="col">도달</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.since}>
                <th scope="row">
                  {dateLabel(row.since)} – {dateLabel(row.until)}
                </th>
                <td>{spendLabel(row.spend)}</td>
                <td>{metric(row.impressions)}</td>
                <td>{metric(row.linkClicks)}</td>
                <td>{metric(row.reach)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function MetaAdsReport() {
  const [report, setReport] = useState<Report | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selectedDate, setSelectedDate] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    let lastRequest = 0
    async function read() {
      if (busy) return
      busy = true
      lastRequest = Date.now()
      try {
        const response = await fetch('/api/meta-ads', {
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        })
        if (!response.ok) throw new Error('report_unavailable')
        const data: Report = await response.json()
        if (
          !['unconfigured', 'pending', 'ready', 'error'].includes(
            data.status,
          ) ||
          !Array.isArray(data.periods) ||
          !Array.isArray(data.daily)
        )
          throw new Error('invalid_report')
        if (!controller.signal.aborted) {
          setReport(data)
          setLoadError(false)
        }
      } catch {
        if (!controller.signal.aborted) {
          setReport(null)
          setLoadError(true)
        }
      } finally {
        busy = false
      }
    }
    function refresh() {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastRequest >= 30000
      )
        void read()
    }
    void read()
    // The collector runs at :15. Refresh an open dashboard after each run.
    const next = new Date()
    next.setMinutes(17, 0, 0)
    if (next.getTime() <= Date.now()) next.setHours(next.getHours() + 1)
    let timer: number
    const first = window.setTimeout(() => {
      refresh()
      timer = window.setInterval(refresh, 60 * 60 * 1000)
    }, next.getTime() - Date.now())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearTimeout(first)
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [retry])

  if (loadError)
    return (
      <Card className="meta-report-section">
        <p role="alert">광고 보고서를 불러오지 못했습니다.</p>
        <Button
          variant="outline"
          onClick={() => {
            setLoadError(false)
            setRetry((n) => n + 1)
          }}
        >
          다시 불러오기
        </Button>
      </Card>
    )
  if (!report)
    return (
      <p role="status" className="meta-report-note">
        광고 보고서를 불러오는 중입니다.
      </p>
    )

  const dates = [...new Set(report.daily.map((row) => row.date))]
    .sort()
    .reverse()
  const periods = report.periods.filter(
    (row) =>
      row.spend !== null ||
      row.impressions !== null ||
      row.linkClicks !== null ||
      row.reach !== null,
  )
  const day = dates.includes(selectedDate) ? selectedDate : dates[0]
  const spendFormat = report.currency
    ? new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: report.currency,
      })
    : null
  const spendLabel = (value: number | null) =>
    value == null
      ? '미수집'
      : spendFormat
        ? spendFormat.format(value)
        : metric(value)
  const syncTime = report.lastSyncedAt
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(report.lastSyncedAt))
    : null
  return (
    <div className="meta-report">
      {report.status === 'unconfigured' && (
        <p className="meta-report-note" role="status">
          광고 계정 연결을 기다리고 있습니다.
        </p>
      )}
      {report.status === 'pending' && (
        <p className="meta-report-note" role="status">
          첫 광고 실적 수집을 기다리고 있습니다. 매시 15분에 인스타그램 광고
          실적을 가져옵니다.
        </p>
      )}
      {report.status === 'error' && (
        <p className="meta-report-note" role="status">
          최근 광고 수집에 실패했습니다.
          {syncTime
            ? ' 아래에 마지막으로 수집한 실적을 표시합니다.'
            : ' 아직 수집된 실적이 없습니다.'}
        </p>
      )}
      {syncTime && (
        <p className="meta-report-updated">
          최근 수집{' '}
          <time dateTime={report.lastSyncedAt!}>{syncTime} (한국 시간)</time>
          {report.timeZone && <> · 집계 시간대 {report.timeZone}</>}
        </p>
      )}
      {report.status === 'ready' && !periods.length && !report.daily.length && (
        <p className="meta-report-note">
          조회한 기간에 Meta에서 반환한 Instagram 광고 실적이 없습니다.
        </p>
      )}
      <PeriodReport kind="week" periods={periods} spendLabel={spendLabel} />
      <PeriodReport kind="month" periods={periods} spendLabel={spendLabel} />
      {dates.length > 0 && (
        <Card className="meta-report-section">
          <div className="meta-report-toolbar">
            <h3>광고별 일일 실적</h3>
            <label>
              조회 날짜
              <select
                value={day}
                onChange={(e) => setSelectedDate(e.target.value)}
              >
                {dates.map((date) => (
                  <option key={date} value={date}>
                    {dateLabel(date)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className="meta-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="광고별 일일 실적"
          >
            <table>
              <caption className="sr-only">{day} 광고별 실적</caption>
              <thead>
                <tr>
                  <th scope="col">광고</th>
                  <th scope="col">광고비</th>
                  <th scope="col">노출</th>
                  <th scope="col">링크 클릭</th>
                </tr>
              </thead>
              <tbody>
                {report.daily
                  .filter((row) => row.date === day)
                  .map((row, index) => (
                    <tr key={index}>
                      <th scope="row">{row.adName}</th>
                      <td>{spendLabel(row.spend)}</td>
                      <td>{metric(row.impressions)}</td>
                      <td>{metric(row.linkClicks)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
