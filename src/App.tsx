import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import {
  ArrowDownUp,
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  Eye,
  Camera,
  LayoutDashboard,
  Link2,
  MousePointer2,
  Newspaper,
  NotebookText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { NumberTicker } from '@/components/number-ticker'
import {
  number,
  won,
  changeLabel,
  periods,
  weeklyReport,
  costPerResult,
} from '@/lib/report'
import * as demo from '@/lib/demo'
import { InstagramConnectPanel } from '@/components/instagram-connect-panel'
import {
  useInstagramConnection,
  instagramErrors,
} from '@/lib/instagram-connection'
import { useReviewedPerformance } from '@/lib/reviewed-performance'
import { useCardPerformance } from '@/lib/meta-card-performance'
import { useVisitorTracker } from '@/lib/visitor-tracker'
import '@/reviewed-dashboard.css'

const ReviewedDashboard = lazy(() => import('@/components/reviewed-dashboard'))
const MediaWorkspace = lazy(() => import('@/components/media-workspace'))
const AdminAnalytics = lazy(() => import('@/components/admin-analytics'))
const shieldLogo = `${import.meta.env.BASE_URL}brand/jb-academy-shield.png`

const WeeklyChart = lazy(() =>
  import('@/components/performance-charts').then((m) => ({
    default: m.WeeklyChart,
  })),
)
const MonthlyChart = lazy(() =>
  import('@/components/performance-charts').then((m) => ({
    default: m.MonthlyChart,
  })),
)
const metrics = [
  {
    key: 'spend',
    label: '광고비',
    unit: '원',
    sub: '이번 주 집행 금액',
    icon: ChartColumn,
  },
  {
    key: 'reach',
    label: '도달',
    unit: '명',
    sub: '광고를 본 고유 계정',
    icon: Users,
  },
  {
    key: 'impressions',
    label: '노출',
    unit: '회',
    sub: '광고가 표시된 횟수',
    icon: Eye,
  },
  {
    key: 'clicks',
    label: '링크 클릭',
    unit: '회',
    sub: '광고 링크 클릭 횟수',
    icon: MousePointer2,
  },
] as const

function EmptyChart({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`empty-chart ${compact ? 'compact' : ''}`}>
      <ChartColumn aria-hidden="true" />
      <strong>아직 집계된 데이터가 없습니다</strong>
      <span>계정 연결 후 실제 광고 실적을 확인할 수 있습니다.</span>
    </div>
  )
}

export default function App() {
  const [sample, setSample] = useState(false)
  const [dialog, setDialog] = useState<'connect' | 'period' | null>(null)
  const [metric, setMetric] = useState<'spend' | 'clicks'>('spend')
  const [level, setLevel] = useState('campaign')
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('all')
  const [descending, setDescending] = useState(true)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState('')
  const [active, setActive] = useState(() =>
    ['news', 'blog', 'campaigns', 'admin'].includes(
      window.location.hash.slice(1),
    )
      ? window.location.hash.slice(1)
      : 'overview',
  )
  const isMedia = active === 'news' || active === 'blog'
  const isAdmin = active === 'admin'
  const adminClicks = useRef({ count: 0, lastAt: 0 })
  useVisitorTracker(
    isAdmin
      ? null
      : dialog === 'connect'
        ? 'connection'
        : active === 'campaigns' || active === 'news' || active === 'blog'
          ? active
          : 'overview',
  )
  const instagram = useInstagramConnection()
  const reviewed = useReviewedPerformance()
  const meta = useCardPerformance(!isMedia && !isAdmin && !sample)
  const showReviewed =
    !sample && Boolean(reviewed.data?.ads.length || meta.report?.cards?.length)
  const linkedInstagram = instagram.status?.authenticated
    ? instagram.status.connection
    : null
  useEffect(() => {
    const navigate = () => {
      const target = window.location.hash.slice(1)
      if (target === 'weekly') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search + '#overview',
        )
        setActive('overview')
      } else if (__INSTAGRAM_BACKEND__ && target === 'ad-report') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search + '#campaigns',
        )
        setSample(false)
        setActive('campaigns')
        document.getElementById('campaigns')?.scrollIntoView()
      } else if (
        ['overview', 'campaigns', 'news', 'blog', 'admin'].includes(target)
      )
        setActive(target)
      else if (!target) setActive('overview')
    }
    navigate()
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    adminClicks.current = { count: 0, lastAt: 0 }
    if (isMedia || isAdmin) window.scrollTo({ top: 0, behavior: 'instant' })
    else if (active === 'campaigns')
      document.getElementById('campaigns')?.scrollIntoView()
  }, [active, isMedia, isAdmin, sample])
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.hash === '#records' || url.hash === '#weekly') {
      url.hash = 'overview'
      window.history.replaceState(
        null,
        '',
        url.pathname + url.search + url.hash,
      )
    }
    const success = url.searchParams.get('instagram_connected')
    const error = url.searchParams.get('instagram_error')
    if (!success && !error) return
    setDialog('connect')
    setSample(false)
    setMessage(
      success
        ? ''
        : instagramErrors[error!] ||
            '인스타그램 연결을 완료하지 못했습니다. 다시 시도해 주세요.',
    )
    url.searchParams.delete('instagram_connected')
    url.searchParams.delete('instagram_error')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [])
  const period = periods(sample ? demo.DEMO_AS_OF : new Date().toISOString())
  const report = sample
    ? weeklyReport(
        demo.current,
        demo.previous,
        demo.results,
        demo.month,
        demo.monthResults,
      )
    : ''
  const rows = sample
    ? demo.detailRows[level]
        .filter(
          (r) =>
            `${r.name} ${r.brand} ${r.objective}`.includes(search) &&
            (brand === 'all' || r.brand === brand),
        )
        .sort((a, b) => (descending ? b.spend - a.spend : a.spend - b.spend))
    : []

  function toggleSample() {
    setSample((v) => !v)
    setCopied(false)
    setMessage('')
  }
  function openAdmin() {
    const now = performance.now()
    const clicks = adminClicks.current
    clicks.count = now - clicks.lastAt <= 1800 ? clicks.count + 1 : 1
    clicks.lastAt = now
    if (clicks.count < 3) return
    clicks.count = 0
    setDialog(null)
    setSample(false)
    setMessage('')
    window.location.hash = 'admin'
    setActive('admin')
  }
  async function copyReport() {
    try {
      await navigator.clipboard.writeText(
        `[예시 데이터 · 실제 보고에 사용하지 마세요]\n인스타그램 광고 주간업무보고\n집계: ${period.current} ${period.time} KST\n${report}`,
      )
      setCopied(true)
      setMessage('예시 보고 문장을 복사했습니다. 실제 실적이 아닙니다.')
    } catch {
      setMessage('복사하지 못했습니다. 보고 문장을 직접 선택해 복사해 주세요.')
    }
  }
  function exportCsv() {
    const escape = (v: unknown) =>
      `"${(String(v).match(/^[=+\-@\t\r]/) ? "'" + String(v) : String(v)).replaceAll('"', '""')}"`
    const csv = [
      ['예시 데이터 — 실제 Meta 실적 아님'],
      ['집계 기간', period.current, `${period.time} KST`],
      [
        '이름',
        '브랜드',
        '결과 항목',
        '결과',
        '결과당 비용(원)',
        '도달(명)',
        '노출(회)',
        '링크 클릭(회)',
        '광고비(원)',
      ],
      ...rows.map((r) => [
        r.name,
        r.brand,
        r.objective,
        r.result,
        r.result ? Math.round(r.spend / r.result) : '',
        r.reach,
        r.impressions,
        r.clicks,
        r.spend,
      ]),
    ]
      .map((row) => row.map(escape).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `JB골프_예시데이터_${level}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('현재 필터의 예시 실적을 CSV로 내보냈습니다.')
  }

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        본문으로 바로가기
      </a>
      <aside className="sidebar">
        {active === 'overview' && (
          <button
            type="button"
            className="admin-entry-hitbox"
            aria-label="관리자 페이지 열기"
            title=""
            onMouseDown={(event) => event.preventDefault()}
            onDragStart={(event) => event.preventDefault()}
            onClick={openAdmin}
          />
        )}
        <a
          href="#overview"
          className="brand academy-brand"
          aria-label="JB GOLF ACADEMY 대시보드"
          draggable={false}
          onMouseDown={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
        >
          <img
            className="academy-shield"
            src={shieldLogo}
            alt="JB GOLF ACADEMY 방패 로고"
            draggable={false}
          />
          <span className="academy-brand-name">
            JB GOLF<span>ACADEMY</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-symbol">
            <img src={shieldLogo} alt="" />
          </span>
          <span>
            JB아카데미<small>Instagram 광고 관리</small>
          </span>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="주 메뉴">
          {[
            { id: 'overview', name: '성과 대시보드', icon: LayoutDashboard },
            { id: 'campaigns', name: '광고 상세', icon: Target },
            { id: 'news', name: '기사', icon: Newspaper },
            { id: 'blog', name: '블로그', icon: NotebookText },
          ].map((item) => (
            <a
              key={item.id}
              aria-label={item.name}
              href={`#${item.id}`}
              className={active === item.id ? 'nav-link active' : 'nav-link'}
              aria-current={active === item.id ? 'location' : undefined}
              onClick={() => setActive(item.id)}
            >
              <item.icon aria-hidden="true" size={18} />
              <span>{item.name}</span>
              {active === item.id && <span className="nav-dot" />}
            </a>
          ))}
          <button
            className="nav-link"
            aria-label="계정 연결"
            onClick={() => setDialog('connect')}
          >
            <Settings2 aria-hidden="true" size={18} />
            <span>계정 연결</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <ShieldCheck size={19} aria-hidden="true" />
            <strong>
              보고는 간결하게.
              <br />
              판단은 정확하게.
            </strong>
            <p>
              매주 확인하는 광고 성과,
              <br />한 화면에서 정리하세요.
            </p>
          </div>
          <button className="profile" onClick={() => setDialog('connect')}>
            <span className="profile-avatar academy-avatar">
              <img src={shieldLogo} alt="" />
            </span>
            <span>
              JB아카데미<small>광고 관리 워크스페이스</small>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            워크스페이스 <ChevronRight size={14} aria-hidden="true" />
            <span>
              {isAdmin
                ? '관리자'
                : active === 'news'
                  ? '기사'
                  : active === 'blog'
                    ? '블로그'
                    : '성과 대시보드'}
            </span>
          </div>
          <div className="topbar-right">
            <span className="connection-status">
              <i />
              {isAdmin
                ? '관리자 전용'
                : isMedia
                  ? '@jbgolfacademy'
                  : showReviewed
                    ? '@jbgolfacademy'
                    : sample
                      ? '예시 데이터 모드'
                      : linkedInstagram
                        ? linkedInstagram.needsReconnect
                          ? 'Instagram 재연결 필요'
                          : 'Instagram 프로필 연결됨'
                        : 'Instagram 계정 미연결'}
            </span>
            <button
              className="help-button"
              aria-label="계정 연결 도움말"
              onClick={() => setDialog('connect')}
            >
              <CircleHelp size={19} />
            </button>
            <span className="top-avatar academy-avatar">
              <img src={shieldLogo} alt="JB아카데미" />
            </span>
          </div>
        </header>
        <main id="main">
          {!isAdmin && !isMedia && (
            <>
              <section id="overview" className="page-heading">
                <div>
                  <p className="eyebrow">MARKETING OVERVIEW</p>
                  <h1>
                    인스타그램 광고 성과<span>.</span>
                  </h1>
                  <p className="page-description">
                    {showReviewed
                      ? 'JB GOLF ACADEMY · 광고별 성과와 주간 변화를 한눈에 확인하세요.'
                      : 'JB골프아카데미와 JB골프클럽의 광고 흐름을 한눈에 확인하세요.'}
                  </p>
                </div>
                {!showReviewed && (
                  <Button
                    variant="outline"
                    className="period-button"
                    onClick={() => setDialog('period')}
                  >
                    <CalendarDays aria-hidden="true" />
                    <span>{period.current}</span>
                    <ChevronDown aria-hidden="true" />
                  </Button>
                )}
              </section>
            </>
          )}
          {reviewed.error && !sample && !isMedia && !isAdmin && (
            <div className="reviewed-load-error" role="status">
              {reviewed.error}
              <Button variant="outline" onClick={() => void reviewed.reload()}>
                자료 다시 불러오기
              </Button>
            </div>
          )}
          {isAdmin ? (
            <Suspense
              fallback={<p role="status">관리자 페이지를 여는 중입니다.</p>}
            >
              <AdminAnalytics />
            </Suspense>
          ) : isMedia ? (
            <Suspense
              fallback={<p role="status">워크스페이스를 여는 중입니다.</p>}
            >
              <MediaWorkspace
                key={active}
                kind={active === 'news' ? 'news' : 'blog'}
              />
            </Suspense>
          ) : showReviewed ? (
            <Suspense
              fallback={
                <p role="status">확인된 광고 성과를 불러오는 중입니다.</p>
              }
            >
              <ReviewedDashboard
                data={reviewed.data}
                report={meta.report}
                failed={meta.failed}
                lifetime={meta.lifetime}
                lifetimeFailed={meta.lifetimeFailed}
              />
            </Suspense>
          ) : (
            <>
              <div
                className={sample ? 'notice sample-notice' : 'notice'}
                role="status"
              >
                <div>
                  <span className="notice-icon">
                    {sample ? (
                      <Eye size={17} aria-hidden="true" />
                    ) : (
                      <Link2 size={17} aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <strong>
                      {sample
                        ? '예시 데이터 미리보기'
                        : linkedInstagram
                          ? '인스타그램 계정이 연결되었습니다'
                          : '인스타그램 계정을 연결해 주세요'}
                    </strong>
                    <span>
                      {sample
                        ? '화면 검토용 합성 데이터입니다. 실제 광고 실적이 아닙니다.'
                        : linkedInstagram
                          ? '광고별 상세 실적에서 집행 결과를 확인하세요.'
                          : '계정 연결 메뉴에서 프로필을 연결할 수 있습니다.'}
                    </span>
                  </span>
                </div>
                <Button variant="ghost" onClick={toggleSample}>
                  {sample ? '예시 닫기' : '예시 데이터 보기'}
                  <ArrowUpRight aria-hidden="true" />
                </Button>
              </div>

              <section className="report-card" aria-labelledby="report-title">
                <div className="report-body">
                  <div className="report-kicker">
                    <Sparkles size={14} aria-hidden="true" /> THIS WEEK’S BRIEF{' '}
                    <span>{sample ? '예시 보고' : '저장된 자료 없음'}</span>
                  </div>
                  <h2 id="report-title">인스타그램 광고 주간업무보고</h2>
                  {sample ? (
                    <p className="report-text">{report}</p>
                  ) : (
                    <>
                      <p className="report-intro">
                        이번 주의 숫자에서, 다음 주의 방향까지.
                      </p>
                      <p className="report-placeholder">
                        저장된 보고 자료가 없습니다.
                        {__INSTAGRAM_BACKEND__ &&
                          ' Meta에서 수집한 실적은 광고별 상세 실적에서 확인하세요.'}
                      </p>
                    </>
                  )}
                  <div className="report-footer">
                    <span className="report-state">
                      <i />
                      {sample
                        ? `예시 집계 기준 · 2026.11.05 ${period.time}`
                        : '저장된 보고서 없음'}
                    </span>
                    <span>한국 표준시 · Instagram 게재 실적</span>
                  </div>
                </div>
                <div className="report-side">
                  <Button
                    className="copy-button"
                    onClick={copyReport}
                    disabled={!sample}
                  >
                    {copied ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Copy aria-hidden="true" />
                    )}
                    {copied ? '복사 완료' : '보고 문장 복사'}
                  </Button>
                  <div className="golf-orbit" aria-hidden="true">
                    <span className="orbit orbit-one" />
                    <span className="orbit orbit-two" />
                    <span className="orbit-line" />
                    <span className="golf-ball">JB</span>
                  </div>
                </div>
              </section>

              <div className="section-heading">
                <div>
                  <p className="eyebrow">WEEKLY PERFORMANCE</p>
                  <h2>이번 주 핵심 성과</h2>
                </div>
                <Badge variant="outline" className="instagram-badge">
                  <Camera aria-hidden="true" /> Instagram만 집계
                </Badge>
              </div>
              <section className="metric-grid" aria-label="이번 주 핵심 지표">
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
                      {sample ? (
                        <NumberTicker value={demo.current[m.key]} />
                      ) : (
                        <span aria-label="계정 미연결">—</span>
                      )}
                      <small>{m.unit}</small>
                    </div>
                    <div className="metric-bottom">
                      {sample ? (
                        <span className="metric-change">
                          <ArrowUpRight size={13} aria-hidden="true" />
                          {changeLabel(
                            demo.current[m.key],
                            demo.previous[m.key],
                            m.unit,
                          )}
                        </span>
                      ) : (
                        <span>{m.sub}</span>
                      )}
                    </div>
                  </Card>
                ))}
              </section>

              <section id="weekly" className="charts-grid">
                <Card className="panel weekly-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">WEEK OVER WEEK</p>
                      <h2>지난주와 이번 주 비교</h2>
                    </div>
                    <div className="segmented" aria-label="추이 지표">
                      <button
                        aria-pressed={metric === 'spend'}
                        onClick={() => setMetric('spend')}
                      >
                        광고비
                      </button>
                      <button
                        aria-pressed={metric === 'clicks'}
                        onClick={() => setMetric('clicks')}
                      >
                        링크 클릭
                      </button>
                    </div>
                  </div>
                  <div className="comparison-period">
                    <p>
                      <i className="legend-dot" />
                      <strong>이번 주</strong>
                      <span>
                        {period.current} · {period.time}
                      </span>
                    </p>
                    <p>
                      <i className="legend-dash" />
                      <strong>지난주</strong>
                      <span>
                        {period.previous} · {period.time}
                      </span>
                    </p>
                  </div>
                  <div className="chart-unit">
                    {metric === 'spend' ? '단위: 원' : '단위: 회'}
                    <span>동일 요일 · 동일 집계 시점</span>
                  </div>
                  <div className="weekly-chart">
                    {sample ? (
                      <Suspense
                        fallback={
                          <div className="chart-loading" role="status">
                            차트를 불러오는 중...
                          </div>
                        }
                      >
                        <WeeklyChart metric={metric} />
                      </Suspense>
                    ) : (
                      <EmptyChart />
                    )}
                  </div>
                  <div className="table-scroll">
                    <table className="comparison-table">
                      <caption className="sr-only">
                        지난주 같은 기간 대비 주요 지표 비교
                      </caption>
                      <thead>
                        <tr>
                          <th>주요 지표</th>
                          <th>지난주</th>
                          <th>이번 주</th>
                          <th>증감량 · 증감률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((m) => (
                          <tr key={m.key}>
                            <th scope="row">{m.label}</th>
                            <td>
                              {sample ? number(demo.previous[m.key]) : '—'}
                            </td>
                            <td>
                              {sample ? number(demo.current[m.key]) : '—'}
                            </td>
                            <td className={sample ? 'delta' : 'muted'}>
                              {sample
                                ? changeLabel(
                                    demo.current[m.key],
                                    demo.previous[m.key],
                                    m.unit,
                                  )
                                : '비교 자료 없음'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {sample && (
                    <details className="data-details">
                      <summary>일별 수치 확인</summary>
                      <div className="table-scroll">
                        <table>
                          <caption className="sr-only">
                            동일 요일 광고비 및 링크 클릭 비교
                          </caption>
                          <thead>
                            <tr>
                              <th>요일</th>
                              <th>지난주 광고비</th>
                              <th>이번 주 광고비</th>
                              <th>지난주 클릭</th>
                              <th>이번 주 클릭</th>
                            </tr>
                          </thead>
                          <tbody>
                            {demo.daily
                              .filter((d) => d.spend !== null)
                              .map((d) => (
                                <tr key={d.day}>
                                  <th>{d.day}</th>
                                  <td>{won(d.beforeSpend!)}</td>
                                  <td>{won(d.spend!)}</td>
                                  <td>{number(d.beforeClicks!)}</td>
                                  <td>{number(d.clicks!)}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  )}
                </Card>

                <Card className="panel month-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">MONTH TO DATE</p>
                      <h2>이번 달 누적 성과</h2>
                    </div>
                    <span className="month-label">
                      {sample
                        ? '11'
                        : new Intl.DateTimeFormat('en-US', {
                            timeZone: 'Asia/Seoul',
                            month: '2-digit',
                          }).format(new Date())}
                      월
                    </span>
                  </div>
                  <p className="month-period">
                    {period.month} · {period.time}
                  </p>
                  <div className="monthly-spend">
                    <span>누적 광고비</span>
                    <strong>
                      {sample ? <NumberTicker value={demo.month.spend} /> : '—'}
                      <small>원</small>
                    </strong>
                    <span className="month-reach">
                      누적 도달{' '}
                      <b>{sample ? `${number(demo.month.reach)}명` : '—'}</b>
                    </span>
                  </div>
                  <div className="month-legend">
                    <span>
                      <i className="legend-square" />
                      광고비 (원 · 왼쪽)
                    </span>
                    <span>
                      <i className="legend-dot" />
                      {sample
                        ? '랜딩 페이지 조회 (회 · 오른쪽)'
                        : '목표별 결과 (계정 연결 후)'}
                    </span>
                  </div>
                  <div className="monthly-chart">
                    {sample ? (
                      <Suspense
                        fallback={
                          <div className="chart-loading" role="status">
                            차트를 불러오는 중...
                          </div>
                        }
                      >
                        <MonthlyChart />
                      </Suspense>
                    ) : (
                      <EmptyChart compact />
                    )}
                  </div>
                  <div className="monthly-results">
                    {sample ? (
                      demo.monthResults.map((r) => (
                        <div key={r.type}>
                          <span>
                            {r.name}
                            <small>해당 목표 광고비 {won(r.spend)}</small>
                          </span>
                          <strong>
                            {number(r.count)}
                            <small>회</small>
                            <em>
                              결과당{' '}
                              {costPerResult(r) === null
                                ? '—'
                                : won(costPerResult(r)!)}
                            </em>
                          </strong>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        계정 연결 후 목표별 누적 결과와 결과당 비용을
                        표시합니다.
                      </p>
                    )}
                  </div>
                  {sample && (
                    <details className="data-details">
                      <summary>월간 일별 수치 확인</summary>
                      <table>
                        <thead>
                          <tr>
                            <th>날짜</th>
                            <th>광고비(원)</th>
                            <th>랜딩 페이지 조회(회)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {demo.monthlyDaily.map((d) => (
                            <tr key={d.day}>
                              <th>{d.day}</th>
                              <td>{number(d.spend)}</td>
                              <td>{number(d.results)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </Card>
              </section>

              <section className="section-heading">
                <div>
                  <p className="eyebrow">RESULTS BY OBJECTIVE</p>
                  <h2>캠페인 목표별 결과</h2>
                </div>
                <span className="section-description">
                  서로 다른 목표의 결과는 합산하지 않습니다.
                </span>
              </section>
              <div className="objective-grid">
                {sample ? (
                  demo.results.map((r, i) => (
                    <Card className="objective-card" key={r.type}>
                      <span
                        className={`objective-icon ${i ? 'secondary-icon' : ''}`}
                      >
                        {i ? (
                          <Eye aria-hidden="true" size={22} />
                        ) : (
                          <MousePointer2 aria-hidden="true" size={22} />
                        )}
                      </span>
                      <div>
                        <span className="objective-name">{r.name}</span>
                        <span className="raw-name">{r.type}</span>
                        <strong>
                          {number(r.count)}
                          <small>{r.unit}</small>
                        </strong>
                      </div>
                      <div className="objective-cost">
                        <span>결과당 비용</span>
                        <strong>{won(costPerResult(r)!)}</strong>
                        <small>목표 광고비 {won(r.spend)}</small>
                      </div>
                    </Card>
                  ))
                ) : (
                  <Card className="objective-empty">
                    <Target aria-hidden="true" />
                    <div>
                      <strong>
                        계정에서 실제 측정되는 결과를 보여 드립니다
                      </strong>
                      <p>
                        캠페인의 목표별 결과명과 단위, 결과당 비용을 구분해
                        표시합니다.
                      </p>
                    </div>
                    <Badge variant="secondary">연결 대기</Badge>
                  </Card>
                )}
              </div>

              <section id="campaigns">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">CAMPAIGN BREAKDOWN</p>
                    <h2>광고별 상세 실적</h2>
                  </div>
                  <Button
                    variant="outline"
                    onClick={exportCsv}
                    disabled={!sample || !rows.length}
                  >
                    <Download aria-hidden="true" />
                    CSV 내보내기
                  </Button>
                </div>
                <Card className="panel detail-panel">
                  <Tabs
                    value={level}
                    onValueChange={setLevel}
                    aria-label="실적 조회 단계"
                  >
                    <div className="detail-controls">
                      <TabsList>
                        <TabsTrigger value="campaign">캠페인</TabsTrigger>
                        <TabsTrigger value="adset">광고 세트</TabsTrigger>
                        <TabsTrigger value="ad">광고</TabsTrigger>
                      </TabsList>
                      <div className="detail-filters">
                        <label className="search-field">
                          <Search size={16} aria-hidden="true" />
                          <input
                            aria-label="광고 이름 검색"
                            placeholder="이름으로 검색"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            disabled={!sample}
                          />
                        </label>
                        <label className="sr-only" htmlFor="brand-filter">
                          브랜드 필터
                        </label>
                        <select
                          id="brand-filter"
                          value={brand}
                          onChange={(e) => setBrand(e.target.value)}
                          disabled={!sample}
                        >
                          <option value="all">전체 브랜드</option>
                          <option>JB골프아카데미</option>
                          <option>JB골프클럽</option>
                        </select>
                      </div>
                    </div>
                    <TabsContent value={level}>
                      <div className="table-scroll">
                        <table className="detail-table">
                          <caption className="sr-only">
                            {sample ? '예시 데이터 — ' : ''}목표별 광고 상세
                            실적
                          </caption>
                          <thead>
                            <tr>
                              <th>
                                {level === 'campaign'
                                  ? '캠페인'
                                  : level === 'adset'
                                    ? '광고 세트'
                                    : '광고'}{' '}
                                이름
                              </th>
                              <th>결과</th>
                              <th>결과당 비용</th>
                              <th>도달</th>
                              <th>노출</th>
                              <th>링크 클릭</th>
                              <th
                                aria-sort={
                                  descending ? 'descending' : 'ascending'
                                }
                              >
                                <button
                                  onClick={() => setDescending((v) => !v)}
                                >
                                  광고비
                                  <ArrowDownUp size={12} aria-hidden="true" />
                                </button>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <strong>
                                    <i />
                                    {r.name}
                                  </strong>
                                  <span>{r.brand} · Instagram</span>
                                </td>
                                <td>
                                  <b>{number(r.result)}회</b>
                                  <span>{r.objective}</span>
                                </td>
                                <td>
                                  {r.result ? won(r.spend / r.result) : '—'}
                                </td>
                                <td>{number(r.reach)}명</td>
                                <td>{number(r.impressions)}회</td>
                                <td>{number(r.clicks)}회</td>
                                <td>
                                  <b>{won(r.spend)}</b>
                                </td>
                              </tr>
                            ))}
                            {!rows.length && (
                              <tr>
                                <td colSpan={7}>
                                  <div className="table-empty">
                                    <Target aria-hidden="true" />
                                    <strong>
                                      {sample
                                        ? '조건에 맞는 광고가 없습니다'
                                        : '저장된 광고 자료가 없습니다'}
                                    </strong>
                                    <p>
                                      {sample
                                        ? '검색어 또는 브랜드 필터를 변경해 주세요.'
                                        : '계정 연결 안내에서 광고 실적을 확인하는 방법을 볼 수 있습니다.'}
                                    </p>
                                    {!sample && (
                                      <Button
                                        variant="outline"
                                        onClick={() => setDialog('connect')}
                                      >
                                        <Link2 aria-hidden="true" />
                                        계정 연결 안내
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </TabsContent>
                    <div className="table-footer">
                      <span>
                        {sample
                          ? `예시 · ${rows.length}개 항목`
                          : '집계 데이터 없음'}
                      </span>
                      <span>도달은 해당 기간의 고유 도달값입니다.</span>
                    </div>
                  </Tabs>
                </Card>
              </section>
              <footer className="page-footer">
                <span>
                  JB GOLF <i>·</i> ACADEMY & CLUB
                </span>
                <span>
                  {sample
                    ? '예시 데이터 · 실제 Meta API와 연결되지 않은 화면입니다.'
                    : linkedInstagram
                      ? '인스타그램 프로필 연결됨'
                      : '인스타그램 프로필 미연결'}
                </span>
                <button onClick={() => setDialog('connect')}>
                  연결 도움말
                  <ArrowUpRight size={13} aria-hidden="true" />
                </button>
                <a href={`${import.meta.env.BASE_URL}privacy/`}>
                  개인정보 처리 안내
                </a>
              </footer>
            </>
          )}
        </main>
      </div>
      <div
        role="status"
        aria-live="polite"
        className={message ? 'toast' : 'sr-only'}
      >
        {message}
        {message && (
          <button onClick={() => setMessage('')} aria-label="알림 닫기">
            닫기
          </button>
        )}
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="connection-dialog">
          <DialogHeader>
            <DialogTitle>
              {dialog === 'period'
                ? '집계 기간과 비교 기준'
                : '인스타그램 계정 연결'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'period'
                ? '월요일부터 집계 시점까지의 성과를 지난주 같은 요일·같은 시점과 비교합니다.'
                : '회사 인스타그램 계정 하나를 공식 로그인으로 연결합니다. 광고 실적 조회 권한은 별도로 설정합니다.'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'period' ? (
            <div className="period-explanation">
              <p>
                <b>이번 주</b>
                {period.current} · {period.time} KST
              </p>
              <p>
                <b>지난주 비교</b>
                {period.previous} · {period.time} KST
              </p>
              <p>
                <b>이번 달</b>
                {period.month} · {period.time} KST
              </p>
              <span>
                실제 연결 시 광고 계정의 시간대·기여 설정에 맞춰 수집 기준을
                확정해야 합니다. 예시 모드의 날짜는 고정되어 있습니다.
              </span>
            </div>
          ) : (
            <>
              <InstagramConnectPanel
                model={instagram}
                onReport={() => {
                  setSample(false)
                  setDialog(null)
                }}
                onSample={() => {
                  setSample(true)
                  setDialog(null)
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
