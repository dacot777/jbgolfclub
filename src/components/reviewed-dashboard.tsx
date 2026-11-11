import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CalendarDays, Camera, ChartColumn } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { number, won } from '@/lib/report'
import { cardRanges, type CardRange } from '@/lib/meta-card-performance'
import type {
  AdDeliveryStatus,
  MetaAdCard,
  MetaLifetimeReport,
  MetaPauseEvent,
  MetaLifetimeRow,
  PublicMetaAdsReport,
} from '@/lib/meta-ads-types'
import type {
  ReviewedAd,
  ReviewedPerformanceData,
} from '@/lib/reviewed-performance-types'

const periodModes = [
  { id: 'lifetime', label: '전체 누적' },
  { id: 'week', label: '주간' },
  { id: 'month', label: '월간' },
] as const
type PeriodMode = (typeof periodModes)[number]['id']
type DashboardAd = Omit<ReviewedAd, 'postUrl' | 'status'> &
  Pick<MetaAdCard, 'startAt' | 'firstDeliveryDate'> & {
    postUrl: string | null
    deliveryStatus?: AdDeliveryStatus
    promotedPostUrl?: string | null
  }
const statusLabels: Record<AdDeliveryStatus, string> = {
  active: '집행 중',
  paused: '일시중단',
  scheduled: '집행 예정',
  archived: '종료됨',
  inactive: '미게재',
  unknown: '상태 확인 중',
}
const emptyAds: ReviewedAd[] = []
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
      promotedPostUrl: match?.postUrl,
      thumbnailUrl: ad.thumbnailUrl ?? match?.thumbnailUrl,
    }
  })
  for (const ad of discovered.values()) {
    cards.push({
      ...ad,
      deliveryStatus: ad.status,
      objective: '',
      schedule: null,
    })
  }
  return cards
}
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
function dateOptionText(range: CardRange) {
  const [year, month, day] = range.since.split('-')
  if (range.kind === 'month') {
    return `${year}년 ${Number(month)}월 · ${Number(day)}–${Number(range.until.slice(8))}일`
  }
  const end = range.until.startsWith(year + '-')
    ? range.until.slice(5)
    : range.until
  return `${dateLabel(range.since)} – ${dateLabel(end)}`
}
function DeliveryDates({
  ad,
  events,
}: {
  ad: DashboardAd
  events: MetaPauseEvent[]
}) {
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
      {events.map((event) => (
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
  selectionLabel,
  liveRange,
  earlierRange,
  lifetimeMode,
  total,
  currency,
}: {
  ad: DashboardAd
  selectionLabel: string
  liveRange?: CardRange
  earlierRange?: CardRange
  lifetimeMode: boolean
  total?: MetaLifetimeRow
  currency: string | null
}) {
  const range = earlierRange ?? liveRange
  const live = lifetimeMode ? total : range?.byCard.get(ad.id)
  const pauseEvents = liveRange?.pausesByCard.get(ad.id) ?? []
  const status = pauseEvents.length
    ? 'paused'
    : ad.deliveryStatus === 'paused'
      ? undefined
      : ad.deliveryStatus
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
          {status ? (
            <span className={`ad-delivery-status ad-status-${status}`}>
              {statusLabels[status]}
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
      <DeliveryDates ad={ad} events={pauseEvents} />
      <div className="reviewed-ad-period">
        <CalendarDays size={14} aria-hidden="true" />
        {lifetimeMode
          ? total
            ? `${total.complete ? '전체 누적 성과' : 'Meta 제공 기간'} · ${dateLabel(total.since)} — ${dateLabel(total.until)}`
            : '전체 누적 성과 · 조회 대기'
          : earlierRange
            ? `마지막 Meta 실적 · ${rangeLabel(earlierRange)}`
            : `Instagram 광고 · ${selectionLabel}`}
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
      ) : (
        <p className="reviewed-ad-empty">
          {ad.deliveryStatus === 'scheduled'
            ? '집행 후 첫 실적이 들어오면 표시됩니다.'
            : lifetimeMode
              ? '이 광고의 Instagram 누적 실적을 기다리고 있습니다.'
              : '선택한 기간에 이 광고로 확인된 Meta 실적이 없습니다.'}
        </p>
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
  const reviewedAds = reviewed?.ads ?? emptyAds
  const ads = useMemo(
    () => displayAds(reviewedAds, report?.cards),
    [reviewedAds, report?.cards],
  )
  const ranges = useMemo(() => cardRanges(report, ads), [report, ads])
  const [mode, setMode] = useState<PeriodMode>('lifetime')
  const [chosenRange, setRange] = useState<string | null>(null)
  const available = ranges.filter((range) => range.kind === mode)
  const liveRange =
    available.find((range) => range.key === chosenRange) ?? available[0]
  const lifetimeMode = !liveRange
  const selectionLabel = liveRange ? rangeLabel(liveRange) : '전체 누적 성과'
  const byId = new Map(
    (lifetime?.totals ?? []).map((row) => [row.reviewedAdId, row]),
  )
  const currency =
    (lifetimeMode ? lifetime?.currency : null) ?? report?.currency ?? null
  useEffect(() => {
    if (window.location.hash === '#campaigns')
      document.getElementById('campaigns')?.scrollIntoView()
  }, [])
  const reportPreview =
    ads
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

  return (
    <div className="reviewed-dashboard">
      <section className="reviewed-period-control" aria-label="성과 조회 기간">
        <div className="period-controls-row">
          <h2 className="period-controls-title">
            <CalendarDays aria-hidden="true" size={18} />
            조회 기간
          </h2>
          <div className="period-modes" role="group" aria-label="조회 기간">
            {periodModes.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === (liveRange?.kind ?? 'lifetime')}
                disabled={
                  id !== 'lifetime' &&
                  !ranges.some((range) => range.kind === id)
                }
                onClick={() => {
                  if (id !== mode) {
                    setMode(id)
                    setRange(null)
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {liveRange && (
          <label className="period-date-picker">
            <span>{liveRange.kind === 'week' ? '조회할 주' : '조회할 달'}</span>
            <select
              value={liveRange.key}
              onChange={(event) => setRange(event.target.value)}
            >
              {available.map((range) => (
                <option key={range.key} value={range.key}>
                  {dateOptionText(range)}
                </option>
              ))}
            </select>
          </label>
        )}
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
              {lifetimeMode ? 'Meta 누적 조회' : 'Meta 수집'}{' '}
              {reviewedTime(
                (lifetimeMode ? lifetime?.asOf : report?.lastSyncedAt) ?? null,
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

      <section id="campaigns" className="reviewed-ads-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AD PERFORMANCE</p>
            <h2>광고별 상세 실적</h2>
          </div>
          <span className="reviewed-coverage">{selectionLabel}</span>
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
              selectionLabel={selectionLabel}
              liveRange={liveRange}
              lifetimeMode={lifetimeMode}
              total={byId.get(ad.id)}
              earlierRange={
                liveRange &&
                (ad.deliveryStatus === 'paused' ||
                  ad.deliveryStatus === 'archived') &&
                !liveRange.byCard.has(ad.id)
                  ? ranges
                      .filter(
                        (range) =>
                          range.kind === liveRange.kind &&
                          range.until <= liveRange.until &&
                          range.byCard.has(ad.id),
                      )
                      .sort((a, b) => b.until.localeCompare(a.until))[0]
                  : undefined
              }
              currency={currency}
            />
          ))}
        </div>
      </section>

      <footer className="page-footer">
        <span>JB GOLF ACADEMY</span>
        <a href={`${import.meta.env.BASE_URL}privacy/`}>개인정보 처리 안내</a>
      </footer>
    </div>
  )
}
