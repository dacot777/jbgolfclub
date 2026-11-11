import { useEffect, useMemo, useState } from 'react'
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
import { cardRanges, type CardRange } from '@/lib/meta-card-performance'
import type {
  AdDeliveryStatus,
  MetaAdCard,
  MetaLifetimeReport,
  MetaLifetimeRow,
  PublicMetaAdsReport,
} from '@/lib/meta-ads-types'
import type {
  ReviewedAd,
  ReviewedMetricKey,
  ReviewedPerformanceData,
  ReviewedSnapshot,
} from '@/lib/reviewed-performance-types'
import {
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
// Temporarily hidden for the submitted report. Re-enable only when requested.
const SHOW_KPIS = false
type DashboardAd = Omit<ReviewedAd, 'postUrl' | 'status'> &
  Pick<MetaAdCard, 'startAt' | 'firstDeliveryDate' | 'pauseEvents'> & {
    postUrl: string | null
    deliveryStatus?: AdDeliveryStatus
    promotedPostUrl?: string | null
    discovered?: boolean
  }
const statusLabels: Record<AdDeliveryStatus, string> = {
  active: '집행 중',
  paused: '일시중단',
  scheduled: '집행 예정',
  archived: '종료됨',
  inactive: '미게재',
  unknown: '상태 확인 중',
}
const emptyReviewed: ReviewedPerformanceData = {
  version: 1,
  source: 'reviewed_screenshots',
  updatedAt: null,
  expectedAdCount: 2,
  ads: [],
  snapshots: [],
}
function displayAds(
  reviewed: ReviewedAd[],
  inventory: MetaAdCard[] = [],
): DashboardAd[] {
  const discovered = new Map(inventory.map((ad) => [ad.id, ad]))
  const cards: DashboardAd[] = reviewed.map((ad) => {
    const match = discovered.get(ad.id)
    discovered.delete(ad.id)
    return {
      ...ad,
      deliveryStatus: match?.status,
      startAt: match?.startAt,
      firstDeliveryDate: match?.firstDeliveryDate,
      pauseEvents: match?.pauseEvents,
      promotedPostUrl: match?.postUrl,
      thumbnailUrl: ad.thumbnailUrl ?? match?.thumbnailUrl,
    }
  })
  for (const ad of discovered.values()) {
    cards.push({
      ...ad,
      deliveryStatus: ad.status,
      discovered: true,
      objective: '',
      schedule: null,
    })
  }
  return cards
}
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
function reviewedTime(value: string | null, seconds = false) {
  return value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(seconds ? { second: '2-digit' as const } : {}),
        hourCycle: 'h23',
      }).format(new Date(value))
    : '아직 없음'
}
function rangeLabel(range: CardRange) {
  const dates =
    range.since === range.until
      ? dateLabel(range.since)
      : `${dateLabel(range.since)} — ${dateLabel(range.until)}`
  return `${{ week: '주간', month: '월간' }[range.kind]} · ${dates}`
}
function currencyLabel(value: number | null, currency: string | null) {
  if (value == null) return '미수집'
  if (currency === 'KRW') return won(Math.round(value))
  return currency
    ? new Intl.NumberFormat('ko-KR', { style: 'currency', currency }).format(
        value,
      )
    : number(value)
}
function resultSummary(
  data: ReviewedPerformanceData,
  rows: ReviewedSnapshot[],
) {
  if (!rows.length) return '선택한 기간의 성과 자료를 기다리고 있습니다.'
  const comments = [
    ...new Set(
      rows
        .map((row) => row.commentary?.trim())
        .filter((comment): comment is string => Boolean(comment)),
    ),
  ]
  if (comments.length) return comments.join('\n')
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

function DeliveryDates({
  ad,
  range,
  zone,
}: {
  ad: DashboardAd
  range?: CardRange
  zone: string
}) {
  const events = ad.pauseEvents ?? []
  const asDay = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  const selected = range
    ? events.filter((event) => {
        const date = asDay(event.at)
        if (date >= range.since && date <= range.until) return true
        const lower = event.previousActiveAt
          ? asDay(event.previousActiveAt)
          : event.lastDeliveryDate
        return (
          event.source === 'observed' &&
          lower &&
          lower <= range.until &&
          date >= range.since
        )
      })
    : events.slice(0, 1)
  return (
    <dl className="ad-delivery-dates">
      <div>
        <dt>광고 시작 일시</dt>
        <dd>
          {ad.startAt
            ? reviewedTime(ad.startAt, true) + ' (광고 세트 설정 · 한국시간)'
            : ad.schedule?.start
              ? dateLabel(ad.schedule.start) + ' (저장된 일정)'
              : '확인 중'}
        </dd>
      </div>
      {ad.firstDeliveryDate && (
        <div>
          <dt>첫 집행 확인일</dt>
          <dd>{dateLabel(ad.firstDeliveryDate)}</dd>
        </div>
      )}
      {selected.map((event) => (
        <div className="ad-stop-record" key={event.source + event.at}>
          <dt>
            {event.source === 'meta'
              ? '일시중단 시각'
              : event.previousActiveAt || event.lastDeliveryDate
                ? '중단 확인 (추정 구간)'
                : '중단 상태 확인 시각'}
          </dt>
          <dd>
            {event.source === 'meta' ? (
              reviewedTime(event.at, true) + ' (한국시간)'
            ) : (
              <>
                {event.previousActiveAt && (
                  <span>
                    집행 중 확인 {reviewedTime(event.previousActiveAt)} ·{' '}
                  </span>
                )}
                {event.lastDeliveryDate && (
                  <span>
                    마지막 집행 확인일 {dateLabel(event.lastDeliveryDate)}{' '}
                    ·{' '}
                  </span>
                )}
                중단 확인 {reviewedTime(event.at)}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function AdPerformance({
  ad,
  row,
  selectionLabel,
  liveRange,
  earlierRange,
  lifetimeMode,
  total,
  zone,
  currency,
}: {
  ad: DashboardAd
  row?: ReviewedSnapshot
  selectionLabel: string
  liveRange?: CardRange
  earlierRange?: CardRange
  lifetimeMode: boolean
  total?: MetaLifetimeRow
  zone: string
  currency: string | null
}) {
  const range = earlierRange ?? liveRange
  const live = lifetimeMode ? total : range?.byCard.get(ad.id)
  const thumbnail = ad.thumbnailUrl ? (
    <img
      src={`${import.meta.env.BASE_URL}${ad.thumbnailUrl.replace(/^\//, '')}`}
      alt={`${ad.title} 광고 썸네일`}
      loading="lazy"
    />
  ) : (
    <span>
      <Camera aria-hidden="true" />
      썸네일 준비 중
    </span>
  )
  return (
    <Card className="reviewed-ad" aria-label={ad.title}>
      <div className="reviewed-ad-heading">
        {ad.postUrl ? (
          <a
            className="reviewed-post-thumbnail"
            href={ad.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${ad.title} 사진 열기`}
          >
            {thumbnail}
          </a>
        ) : (
          <figure className="reviewed-post-thumbnail">{thumbnail}</figure>
        )}
        <div>
          {ad.deliveryStatus ? (
            <span
              className={`ad-delivery-status ad-status-${ad.deliveryStatus}`}
            >
              {statusLabels[ad.deliveryStatus]}
            </span>
          ) : (
            <span className="reviewed-ad-eyebrow">INSTAGRAM AD</span>
          )}
          <h3>{ad.title}</h3>
          {ad.objective && <p>{ad.objective}</p>}
          {ad.postUrl && (
            <a
              className="reviewed-post-link"
              href={ad.postUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Instagram 게시물 보기
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
          {ad.promotedPostUrl && ad.promotedPostUrl !== ad.postUrl && (
            <a
              className="reviewed-post-link"
              href={ad.promotedPostUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              실제 집행 게시물 보기{' '}
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
      <DeliveryDates ad={ad} range={liveRange} zone={zone} />
      <div className="reviewed-ad-period">
        <CalendarDays size={14} aria-hidden="true" />
        {lifetimeMode
          ? total
            ? `${total.complete ? '전체 누적 성과' : 'Meta 제공 기간'} · ${dateLabel(total.since)} — ${dateLabel(total.until)}`
            : '전체 누적 성과 · 조회 대기'
          : earlierRange
            ? `마지막 저장 실적 · ${rangeLabel(earlierRange)}`
            : liveRange
              ? `Instagram 광고 · ${selectionLabel}`
              : row?.period
                ? `${dateLabel(row.period.start)} — ${dateLabel(row.period.end)}`
                : row
                  ? '전체 기간 누적 · 집계 날짜 확인 중'
                  : `${selectionLabel} · 성과 자료 대기`}
      </div>
      {lifetimeMode && total?.asOf && (
        <p className="ad-metric-asof">
          Meta 조회 {reviewedTime(total.asOf)} (한국시간)
        </p>
      )}
      {live ? (
        <dl className="reviewed-ad-values">
          <div>
            <dt>지출</dt>
            <dd>{currencyLabel(live.spend, currency)}</dd>
          </div>
          <div>
            <dt>노출</dt>
            <dd>
              {live.impressions == null
                ? '미수집'
                : valueLabel(live.impressions, '회')}
            </dd>
          </div>
          <div>
            <dt>도달</dt>
            <dd>
              {live.reach == null ? '미수집' : valueLabel(live.reach, '명')}
            </dd>
          </div>
          <div>
            <dt>링크 클릭</dt>
            <dd>
              {live.linkClicks == null
                ? '미수집'
                : valueLabel(live.linkClicks, '회')}
            </dd>
          </div>
          {live.spend != null &&
            live.linkClicks != null &&
            live.linkClicks > 0 && (
              <div>
                <dt>링크 클릭당 비용</dt>
                <dd>{currencyLabel(live.spend / live.linkClicks, currency)}</dd>
              </div>
            )}
        </dl>
      ) : liveRange || lifetimeMode ? (
        <p className="reviewed-ad-empty">
          {ad.deliveryStatus === 'scheduled'
            ? '집행 후 첫 실적이 들어오면 표시됩니다.'
            : lifetimeMode
              ? '이 광고의 Instagram 누적 실적을 기다리고 있습니다.'
              : '선택한 기간에 이 광고로 확인된 Meta 실적이 없습니다.'}
        </p>
      ) : row ? (
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
      ) : ad.discovered ? (
        <p className="reviewed-ad-empty">아직 선택한 기간의 실적이 없습니다.</p>
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
  data: reviewed,
  report,
  lifetime,
  lifetimeFailed,
  failed,
}: {
  data: ReviewedPerformanceData | null
  report: PublicMetaAdsReport | null
  lifetime: MetaLifetimeReport | null
  lifetimeFailed: boolean
  failed: boolean
}) {
  const data = reviewed ?? emptyReviewed
  const ads = useMemo(
    () => displayAds(data.ads, report?.cards),
    [data.ads, report?.cards],
  )
  const ranges = useMemo(() => cardRanges(report, ads), [report, ads])
  const [chosen, setSelection] = useState<string | null>(null)
  const selection =
    chosen &&
    (!chosen.startsWith('meta:') || ranges.some((r) => r.key === chosen))
      ? chosen
      : __INSTAGRAM_BACKEND__
        ? 'lifetime'
        : 'latest'
  const liveRange = ranges.find((range) => range.key === selection)
  const lifetimeMode = selection === 'lifetime'
  const byId = new Map(
    (lifetime?.totals ?? []).map((row) => [row.reviewedAdId, row]),
  )
  const currency =
    (lifetimeMode ? lifetime?.currency : null) ?? report?.currency ?? null
  useEffect(() => {
    if (window.location.hash === '#campaigns')
      document.getElementById('campaigns')?.scrollIntoView()
  }, [])
  const knownRanges = new Map(
    data.snapshots
      .filter(
        (s) =>
          s.period &&
          s.scope === 'selected_period' &&
          Object.values(s.metrics).some((value) => value !== null),
      )
      .map((s) => [periodKey(s.period!), s.period!]),
  )
  const options = [...knownRanges.entries()]
    .map(([key, p]) => ({
      key,
      label: `${dateLabel(p.start)} — ${dateLabel(p.end)}`,
      start: p.start,
      end: p.end,
      days:
        Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1,
    }))
    .sort(
      (a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start),
    )
  const selectedOption = options.find((w) => w.key === selection)
  const selectionLabel = liveRange
    ? rangeLabel(liveRange)
    : lifetimeMode
      ? '전체 누적 성과'
      : selection === 'latest'
        ? '저장된 누적 기록'
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
  const reportPreview =
    liveRange || lifetimeMode
      ? ads
          .flatMap((ad) => {
            const metrics = lifetimeMode
              ? byId.get(ad.id)
              : liveRange?.byCard.get(ad.id)
            if (!metrics) return []
            const parts = [
              metrics.linkClicks != null &&
                `링크 클릭 ${number(metrics.linkClicks)}회`,
              metrics.spend != null &&
                `지출 ${currencyLabel(metrics.spend, currency)}`,
            ].filter(Boolean)
            return parts.length ? [`${ad.title} · ${parts.join(' · ')}`] : []
          })
          .join('\n') ||
        '선택한 기간의 링크 클릭과 지출은 아직 확인되지 않았습니다.'
      : resultSummary(data, rows)
  const hasIncomplete = rows.length < data.expectedAdCount

  return (
    <div className="reviewed-dashboard">
      <section className="reviewed-period-control" aria-label="성과 조회 기간">
        <div>
          <CalendarDays aria-hidden="true" />
          <span>
            지난 성과도, 원하는 기간으로.
            <small>기간을 선택하면 아래 광고별 실적이 바뀝니다.</small>
          </span>
        </div>
        <label>
          조회 기간
          <select
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          >
            {__INSTAGRAM_BACKEND__ && (
              <option value="lifetime">전체 누적 성과</option>
            )}
            {ranges.length > 0 && (
              <optgroup label="Instagram 광고 실적">
                {ranges.map((range) => (
                  <option key={range.key} value={range.key}>
                    {rangeLabel(range)}
                  </option>
                ))}
              </optgroup>
            )}
            {(data.snapshots.length > 0 || !report?.cards?.length) && (
              <optgroup label="저장된 실적">
                <option value="latest">저장된 누적 기록</option>
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </section>

      <section
        id="result-summary"
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
              {lifetimeMode
                ? 'Meta 누적 조회'
                : liveRange
                  ? 'Meta 수집'
                  : '최근 업데이트'}{' '}
              {reviewedTime(
                lifetimeMode
                  ? (lifetime?.asOf ?? null)
                  : liveRange
                    ? (report?.lastSyncedAt ?? null)
                    : data.updatedAt,
              )}
            </span>
          </div>
          {lifetimeMode && (
            <small className="ad-metric-asof">
              화면을 열어 둔 동안 1분마다 조회합니다. Meta 집계에 따라 수치
              반영이 늦어질 수 있습니다.
            </small>
          )}
        </div>
      </section>

      {SHOW_KPIS && (
        <>
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
              광고별 집계 날짜가 다르거나 확인되지 않아 합계는 산출하지
              않았습니다. 아래 광고별 수치를 확인하세요.
            </p>
          )}
        </>
      )}

      <section id="campaigns" className="reviewed-ads-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AD PERFORMANCE</p>
            <h2>광고별 상세 실적</h2>
          </div>
          <span className="reviewed-coverage">
            {liveRange || lifetimeMode
              ? selectionLabel
              : '게시물 링크 · 확인된 원본 지표'}
          </span>
        </div>
        {(lifetimeMode
          ? lifetimeFailed || lifetime?.status === 'error'
          : failed || report?.status === 'error') && (
          <p role="status">
            최근 Meta 실적을 갱신하지 못했습니다. 마지막으로 저장된 자료를
            표시합니다.
          </p>
        )}
        <div className="reviewed-ad-grid">
          {ads.map((ad) => (
            <AdPerformance
              key={ad.id}
              ad={ad}
              row={rows.find((r) => r.adId === ad.id)}
              selectionLabel={selectionLabel}
              liveRange={liveRange}
              lifetimeMode={lifetimeMode}
              total={byId.get(ad.id)}
              zone={report?.timeZone ?? 'Asia/Seoul'}
              earlierRange={
                liveRange &&
                (ad.deliveryStatus === 'paused' ||
                  ad.deliveryStatus === 'archived') &&
                !liveRange.byCard.has(ad.id)
                  ? ranges
                      .filter(
                        (range) =>
                          range.until <= liveRange.until &&
                          range.byCard.has(ad.id),
                      )
                      .sort(
                        (a, b) =>
                          Number(b.kind === liveRange.kind) -
                            Number(a.kind === liveRange.kind) ||
                          b.until.localeCompare(a.until),
                      )[0]
                  : undefined
              }
              currency={currency}
            />
          ))}
          {!report?.cards?.length && data.ads.length < data.expectedAdCount && (
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

      {options.length > 0 && (
        <section
          className="reviewed-history"
          aria-labelledby="reviewed-history-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">WEEKLY HISTORY</p>
              <h2 id="reviewed-history-title">저장된 기간별 성과</h2>
            </div>
          </div>
          <Card className="reviewed-history-card">
            <div className="table-scroll">
              <table className="reviewed-history-table">
                <caption className="sr-only">
                  집계 기간이 확인된 실제 성과 기록
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
            <p>집계 기간이 확인된 실제 성과 기록입니다.</p>
          </Card>
        </section>
      )}
      <footer className="page-footer">
        <span>JB GOLF ACADEMY</span>
        <a href={`${import.meta.env.BASE_URL}privacy/`}>개인정보 처리 안내</a>
      </footer>
    </div>
  )
}
