import { useEffect, useEffectEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type {
  MetaAdsReport as Report,
  MetaAdsPeriod as Period,
} from '@/lib/meta-ads-types'

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
      <h2>{title}</h2>
      <div
        className="admin-view-scroll"
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

export function MetaAdsReport({ onExpired }: { onExpired: () => void }) {
  const [report, setReport] = useState<Report | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selectedDate, setSelectedDate] = useState('')
  const expire = useEffectEvent(onExpired)

  useEffect(() => {
    const controller = new AbortController()
    let busy = false
    let lastRequest = 0
    async function read() {
      if (busy) return
      busy = true
      lastRequest = Date.now()
      try {
        const response = await fetch('/api/admin/meta-ads', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        })
        if (response.status === 401) {
          if (!controller.signal.aborted) {
            setReport(null)
            expire()
          }
          return
        }
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
    const timer = window.setInterval(refresh, 60 * 60 * 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
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
      <p role="status" className="admin-loading">
        광고 보고서를 불러오는 중입니다.
      </p>
    )

  const dates = [...new Set(report.daily.map((row) => row.date))]
    .sort()
    .reverse()
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
        <p className="admin-private-note" role="status">
          광고 계정 연결 대기 중입니다. 광고 계정 소유자가 Meta의 광고 성과 읽기
          권한을 승인하고 서버에 연결하면 매시간 실적을 가져옵니다.
        </p>
      )}
      {report.status === 'pending' && (
        <p className="admin-private-note" role="status">
          첫 광고 실적 수집을 기다리고 있습니다.
        </p>
      )}
      {report.status === 'error' && (
        <p className="admin-error" role="status">
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
      {report.status === 'ready' &&
        !report.periods.length &&
        !report.daily.length && (
          <p className="admin-private-note">
            조회한 기간에 Meta에서 반환한 Instagram 광고 실적이 없습니다.
          </p>
        )}
      <PeriodReport
        kind="week"
        periods={report.periods}
        spendLabel={spendLabel}
      />
      <PeriodReport
        kind="month"
        periods={report.periods}
        spendLabel={spendLabel}
      />
      {dates.length > 0 && (
        <Card className="meta-report-section">
          <div className="admin-toolbar">
            <h2>광고별 일일 실적</h2>
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
            className="admin-view-scroll"
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
                  .map((row) => (
                    <tr key={row.adId}>
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
