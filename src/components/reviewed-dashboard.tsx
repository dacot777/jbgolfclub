import { useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  Camera,
  ChartColumn,
  Eye,
  MousePointer2,
  Target,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { number, won, changeLabel } from '@/lib/report'
import type {
  ReviewedAd,
  ReviewedMetricKey,
  ReviewedPerformanceData,
  ReviewedSnapshot,
} from '@/lib/reviewed-performance-types'
import {
  monthPeriods,
  periodKey,
  previousPeriod,
  rowsForSelection,
  summarizeReviewed,
} from '@/lib/reviewed-report'

const metrics = [
  { key: 'spend', label: '광고비', unit: '원', icon: ChartColumn },
  { key: 'profileVisits', label: '프로필 방문', unit: '회', icon: Users },
  { key: 'views', label: '조회수', unit: '회', icon: Eye },
  { key: 'linkClicks', label: '링크 클릭', unit: '회', icon: MousePointer2 },
] as const
const detailMetrics: { key: ReviewedMetricKey; label: string; unit: string }[] =
  [
    { key: 'spend', label: '지출', unit: '원' },
    { key: 'profileVisits', label: 'Instagram 프로필 방문', unit: '회' },
    { key: 'profileVisitCost', label: '프로필 방문당 비용', unit: '원' },
    { key: 'websiteVisits', label: '웹사이트 방문', unit: '회' },
    { key: 'websiteVisitCost', label: '웹사이트 방문당 비용', unit: '원' },
    { key: 'views', label: '조회수', unit: '회' },
    { key: 'viewers', label: '조회한 사람', unit: '명' },
    { key: 'linkClicks', label: '링크 클릭', unit: '회' },
    { key: 'linkClickCost', label: '링크 클릭당 비용', unit: '원' },
    { key: 'landingPageViews', label: '랜딩 페이지 조회', unit: '회' },
    { key: 'postEngagements', label: '게시물 참여', unit: '회' },
    { key: 'likes', label: '게시물 공감', unit: '회' },
    { key: 'video3s', label: '동영상 3초 이상 재생', unit: '회' },
  ]
const dateLabel = (date: string) => date.replaceAll('-', '.')
const valueLabel = (value: number | null, unit: string) =>
  value === null ? '—' : `${number(value)}${unit}`
function reviewedTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value))
    : '아직 없음'
}
function koreanMonth(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value))
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`
}
function initialSelection(data: ReviewedPerformanceData) {
  const confirmed = data.snapshots
    .filter((s) => s.scope === 'selected_period' && s.period)
    .sort((a, b) => b.period!.end.localeCompare(a.period!.end))
  return confirmed.length ? periodKey(confirmed[0].period!) : 'latest'
}
function resultSummary(
  data: ReviewedPerformanceData,
  rows: ReviewedSnapshot[],
) {
  if (!rows.length) return '선택한 기간의 성과 자료를 기다리고 있습니다.'
  return rows
    .map((row) => {
      const title = data.ads.find((ad) => ad.id === row.adId)?.title ?? '광고'
      const m = row.metrics
      const result =
        m.profileVisits !== null
          ? `프로필 방문 ${number(m.profileVisits)}회${m.profileVisitCost !== null ? ` · 방문당 ${won(m.profileVisitCost)}` : ''}`
          : m.linkClicks !== null
            ? `링크 클릭 ${number(m.linkClicks)}회${m.linkClickCost !== null ? ` · 클릭당 ${won(m.linkClickCost)}` : ''}`
            : m.websiteVisits !== null
              ? `웹사이트 방문 ${number(m.websiteVisits)}회`
              : '결과 집계 대기'
      return `${title}: ${result}${m.spend !== null ? ` · 광고비 ${won(m.spend)}` : ''}`
    })
    .join('\n')
}

function AdPerformance({
  ad,
  row,
  selectionLabel,
}: {
  ad: ReviewedAd
  row?: ReviewedSnapshot
  selectionLabel: string
}) {
  return (
    <Card className="reviewed-ad" aria-label={ad.title}>
      <div className="reviewed-ad-heading">
        <a
          className="reviewed-post-thumbnail"
          href={ad.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${ad.title} 사진 열기`}
        >
          {ad.thumbnailUrl ? (
            <img
              src={`${import.meta.env.BASE_URL}${ad.thumbnailUrl.replace(/^\//, '')}`}
              alt={`${ad.title} 광고 썸네일`}
            />
          ) : (
            <span>
              <Camera aria-hidden="true" />
              광고 이미지
            </span>
          )}
        </a>
        <div>
          <span className="reviewed-ad-eyebrow">INSTAGRAM AD</span>
          <h3>{ad.title}</h3>
          <p>{ad.objective}</p>
          <a
            className="reviewed-post-link"
            href={ad.postUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Instagram 게시물 보기
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="reviewed-ad-period">
        <CalendarDays size={14} aria-hidden="true" />
        {row?.period
          ? `${dateLabel(row.period.start)} — ${dateLabel(row.period.end)}`
          : row
            ? '전체 기간 누적 · 집계 날짜 확인 중'
            : `${selectionLabel} · 성과 자료 대기`}
      </div>
      {row ? (
        <>
          <dl className="reviewed-ad-values">
            {detailMetrics
              .filter((m) => row.metrics[m.key] !== null)
              .map((m) => (
                <div key={m.key}>
                  <dt>{m.label}</dt>
                  <dd>{valueLabel(row.metrics[m.key], m.unit)}</dd>
                </div>
              ))}
          </dl>
        </>
      ) : (
        <div className="reviewed-ad-empty">
          <Target aria-hidden="true" />
          <strong>선택한 기간의 성과 자료가 없습니다</strong>
          <p>해당 기간의 캡처가 확인되면 이 광고의 주간 실적에 반영합니다.</p>
        </div>
      )}
      {ad.schedule && (
        <details className="reviewed-schedule">
          <summary>광고 설정 · 집계 기간과 별도</summary>
          <dl>
            <div>
              <dt>광고 일정</dt>
              <dd>
                {dateLabel(ad.schedule.start)} — {dateLabel(ad.schedule.end)}
              </dd>
            </div>
            {ad.schedule.dailyBudget !== null && (
              <div>
                <dt>일일 예산</dt>
                <dd>{won(ad.schedule.dailyBudget)}</dd>
              </div>
            )}
            {ad.schedule.totalBudget != null && (
              <div>
                <dt>총 예산</dt>
                <dd>{won(ad.schedule.totalBudget)}</dd>
              </div>
            )}
            <div>
              <dt>설정 기간</dt>
              <dd>{ad.schedule.durationDays}일</dd>
            </div>
          </dl>
        </details>
      )}
      {ad.targeting && (
        <details className="reviewed-schedule">
          <summary>광고 타겟</summary>
          <dl>
            <div>
              <dt>지역</dt>
              <dd>{ad.targeting.locations.join(' · ')}</dd>
            </div>
            <div>
              <dt>연령</dt>
              <dd>
                {ad.targeting.ageMin}~{ad.targeting.ageMax}세
              </dd>
            </div>
            <div>
              <dt>관심사</dt>
              <dd>{ad.targeting.interests.join(' · ') || '미기록'}</dd>
            </div>
            {ad.targeting.locationOptimization !== null && (
              <div>
                <dt>위치 최적화</dt>
                <dd>{ad.targeting.locationOptimization ? '설정' : '해제'}</dd>
              </div>
            )}
            {ad.targeting.advantageDetailedTargeting !== null && (
              <div>
                <dt>어드밴티지 상세 타게팅</dt>
                <dd>
                  {ad.targeting.advantageDetailedTargeting ? '설정' : '해제'}
                </dd>
              </div>
            )}
            {ad.targeting.advantageAudience !== null && (
              <div>
                <dt>어드밴티지 타겟</dt>
                <dd>{ad.targeting.advantageAudience ? '설정' : '해제'}</dd>
              </div>
            )}
          </dl>
        </details>
      )}
    </Card>
  )
}

export default function ReviewedDashboard({
  data,
}: {
  data: ReviewedPerformanceData
}) {
  const [selection, setSelection] = useState(() => initialSelection(data))
  const [month, setMonth] = useState(() => {
    const initial = initialSelection(data)
    return initial === 'latest'
      ? koreanMonth(data.updatedAt ?? new Date().toISOString())
      : initial.split('|')[1].slice(0, 7)
  })
  const weeks = monthPeriods(month)
  const knownRanges = new Map(
    data.snapshots
      .filter(
        (s) =>
          s.period &&
          s.scope === 'selected_period' &&
          (s.period.start.startsWith(month) || s.period.end.startsWith(month)),
      )
      .map((s) => [periodKey(s.period!), s.period!]),
  )
  const additional = [...knownRanges.entries()]
    .filter(([key]) => !weeks.some((w) => w.key === key))
    .map(([key, p]) => ({
      key,
      label: `확인된 별도 기간 ${dateLabel(p.start)} — ${dateLabel(p.end)}`,
      start: p.start,
      end: p.end,
      days:
        Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1,
    }))
  const options = [...weeks, ...additional]
  const selectedOption = options.find((w) => w.key === selection)
  const selectionLabel =
    selection === 'latest'
      ? '전체 누적 성과'
      : selectedOption
        ? `${dateLabel(selectedOption.start)} — ${dateLabel(selectedOption.end)}`
        : selection.replace('|', ' — ')
  const rows = rowsForSelection(data, selection)
  const summary = summarizeReviewed(rows)
  const before = previousPeriod(selection)
  const previousRows = before ? rowsForSelection(data, before.key) : []
  const previous = summarizeReviewed(previousRows)
  const comparable =
    summary.canAggregate &&
    previous.canAggregate &&
    rows.length > 0 &&
    rows
      .map((r) => r.adId)
      .sort()
      .join('|') ===
      previousRows
        .map((r) => r.adId)
        .sort()
        .join('|')
  const reportPreview = resultSummary(data, rows)
  const hasIncomplete = rows.length < data.expectedAdCount

  return (
    <div className="reviewed-dashboard">
      <section id="overview" className="page-heading">
        <div>
          <p className="eyebrow">MARKETING OVERVIEW</p>
          <h1>
            인스타그램 광고 성과<span>.</span>
          </h1>
          <p className="page-description">
            JB GOLF ACADEMY · 광고별 성과와 주간 변화를 한눈에 확인하세요.
          </p>
        </div>
      </section>
      <section className="reviewed-period-control" aria-label="성과 조회 기간">
        <div>
          <CalendarDays aria-hidden="true" />
          <span>
            지난 성과도, 원하는 기간으로.
            <small>7일 단위 기록을 선택해 다시 확인하세요.</small>
          </span>
        </div>
        <label>
          조회 월
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) {
                const choices = monthPeriods(e.target.value)
                if (choices.length) {
                  setMonth(e.target.value)
                  setSelection(choices[0].key)
                }
              }
            }}
          />
        </label>
        <label>
          조회 기간
          <select
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          >
            <option value="latest">전체 누적 성과</option>
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label} · {option.start.slice(5).replace('-', '/')}~
                {option.end.slice(5).replace('-', '/')}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section
        id="weekly"
        className="report-card"
        aria-labelledby="reviewed-report-title"
      >
        <div className="report-body">
          <div className="report-kicker">
            <ChartColumn size={14} aria-hidden="true" /> PERFORMANCE SUMMARY
          </div>
          <h2 id="reviewed-report-title">한 줄 결과</h2>
          <p className="reviewed-report-text">{reportPreview}</p>
          <div className="report-footer">
            <span className="report-state">
              <i />
              최근 업데이트: {reviewedTime(data.updatedAt)}
            </span>
          </div>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <p className="eyebrow">PERFORMANCE</p>
          <h2>핵심 성과</h2>
        </div>
        <span className="reviewed-coverage">
          {hasIncomplete
            ? `${rows.length}개 광고 자료 · 전체 2개 중 일부`
            : '2개 광고 자료'}
        </span>
      </div>
      <section className="metric-grid" aria-label="확인된 핵심 지표">
        {metrics.map((m, i) => (
          <Card
            className={`metric-card ${i === 0 ? 'metric-primary' : ''}`}
            key={m.key}
          >
            <div className="metric-label">
              <span>{m.label}</span>
              <m.icon size={18} aria-hidden="true" />
            </div>
            <div className="metric-value">
              {summary.metrics[m.key] !== null ? (
                <span>{number(summary.metrics[m.key]!)}</span>
              ) : (
                <span
                  className={
                    rows.length > 1 && !summary.canAggregate
                      ? 'reviewed-no-sum'
                      : ''
                  }
                >
                  {rows.length > 1 && !summary.canAggregate
                    ? '광고별 확인'
                    : '—'}
                </span>
              )}
              <small>{m.unit}</small>
            </div>
            <p className="reviewed-metric-sub">
              {comparable &&
              summary.metrics[m.key] !== null &&
              previous.metrics[m.key] !== null
                ? changeLabel(
                    summary.metrics[m.key]!,
                    previous.metrics[m.key]!,
                    m.unit,
                  )
                : rows.length
                  ? '같은 기준의 이전 기간 비교 자료 없음'
                  : '선택 기간의 자료 없음'}
            </p>
          </Card>
        ))}
      </section>
      {rows.length > 1 && !summary.canAggregate && (
        <p className="reviewed-caution">
          광고별 집계 날짜가 다르거나 확인되지 않아 합계는 산출하지 않았습니다.
          아래 광고별 수치를 확인하세요.
        </p>
      )}

      <section id="campaigns" className="reviewed-ads-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AD PERFORMANCE</p>
            <h2>광고별 상세 실적</h2>
          </div>
          <span className="reviewed-coverage">
            게시물 링크 · 확인된 원본 지표
          </span>
        </div>
        <div className="reviewed-ad-grid">
          {data.ads.map((ad) => (
            <AdPerformance
              key={ad.id}
              ad={ad}
              row={rows.find((r) => r.adId === ad.id)}
              selectionLabel={selectionLabel}
            />
          ))}
          {data.ads.length < data.expectedAdCount && (
            <Card className="reviewed-ad reviewed-awaiting">
              <Target size={30} aria-hidden="true" />
              <h3>두 번째 광고 자료 대기</h3>
              <p>
                게시물 링크와 성과 캡처가 전달되면
                <br />
                같은 대시보드에 함께 반영합니다.
              </p>
              <span>없는 수치를 추정해 넣지 않습니다.</span>
            </Card>
          )}
        </div>
      </section>

      <section
        className="reviewed-history"
        aria-labelledby="reviewed-history-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">WEEKLY HISTORY</p>
            <h2 id="reviewed-history-title">
              {Number(month.slice(0, 4))}년 {Number(month.slice(5))}월 · 주간
              성과
            </h2>
          </div>
        </div>
        <Card className="reviewed-history-card">
          <div className="table-scroll">
            <table className="reviewed-history-table">
              <caption className="sr-only">
                선택 월의 주간별 성과, 정확한 집계 기간이 확인된 자료만 표시
              </caption>
              <thead>
                <tr>
                  <th>집계 기간</th>
                  <th>확인 광고</th>
                  <th>광고비</th>
                  <th>조회수</th>
                  <th>링크 클릭</th>
                  <th>
                    <span className="sr-only">기간 선택</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {options.map((option) => {
                  const historyRows = rowsForSelection(data, option.key)
                  const history = summarizeReviewed(historyRows)
                  return (
                    <tr
                      key={option.key}
                      className={selection === option.key ? 'selected' : ''}
                    >
                      <td>
                        <strong>{option.label}</strong>
                        <span>
                          {dateLabel(option.start)} — {dateLabel(option.end)}
                        </span>
                      </td>
                      <td>
                        {historyRows.length
                          ? `${historyRows.length}/2개`
                          : '자료 대기'}
                      </td>
                      <td>{valueLabel(history.metrics.spend, '원')}</td>
                      <td>{valueLabel(history.metrics.views, '회')}</td>
                      <td>{valueLabel(history.metrics.linkClicks, '회')}</td>
                      <td>
                        <Button
                          variant={
                            selection === option.key ? 'secondary' : 'ghost'
                          }
                          size="sm"
                          aria-label={`${option.label} 성과 보기`}
                          onClick={() => setSelection(option.key)}
                        >
                          보기
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p>
            1~7일 · 8~14일 · 15~21일 · 22~28일로 구분하고 29일부터는 월말 잔여
            기간으로 표시합니다. 집계일 미확인·전체 기간 누적 자료를 임의로
            나누지 않습니다.
          </p>
        </Card>
      </section>
      <footer className="page-footer">
        <span>JB GOLF ACADEMY</span>
        <span>광고 성과 대시보드</span>
      </footer>
    </div>
  )
}
