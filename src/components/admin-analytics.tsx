import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Clock3,
  Eye,
  LockKeyhole,
  LogOut,
  Monitor,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  ANALYTICS_MENU_NAMES,
  type AdminSession,
  type AnalyticsReport,
  type AnalyticsVisit,
} from '@/lib/analytics-types'
import '@/admin-analytics.css'

const InquiryWorkspace = lazy(() => import('./inquiry-workspace'))

function timestamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '확인되지 않음'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
}
function duration(value: number) {
  if (!Number.isFinite(value) || value < 0) return '확인되지 않음'
  const seconds = Math.floor(value / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours) return `${hours}시간 ${minutes}분`
  if (minutes) return `${minutes}분 ${seconds % 60}초`
  return `${seconds}초`
}
function sessionData(value: unknown): AdminSession {
  const result = value as AdminSession
  if (
    !result ||
    typeof result.configured !== 'boolean' ||
    typeof result.authenticated !== 'boolean' ||
    (result.authenticated &&
      (typeof result.csrfToken !== 'string' || !result.csrfToken))
  )
    throw new Error('invalid_session')
  return result
}
function reportData(value: unknown): AnalyticsReport {
  const result = value as AnalyticsReport
  if (
    !result ||
    ![1, 7, 30].includes(result.days) ||
    !Array.isArray(result.visits) ||
    !Number.isSafeInteger(result.page) ||
    !Number.isSafeInteger(result.totalPages) ||
    !Number.isSafeInteger(result.totalVisits) ||
    !Number.isSafeInteger(result.totalVisitors) ||
    typeof result.totalActiveMs !== 'number' ||
    !result.visits.every(
      (visit) =>
        visit &&
        typeof visit.id === 'string' &&
        typeof visit.visitorLabel === 'string' &&
        Array.isArray(visit.views),
    )
  )
    throw new Error('invalid_report')
  return result
}

function VisitRecord({ visit }: { visit: AnalyticsVisit }) {
  return (
    <Card
      className="admin-visit"
      aria-label={`${visit.visitorLabel} 방문 기록`}
    >
      <div className="admin-visit-heading">
        <span className="admin-visitor-icon">
          <Users aria-hidden="true" size={18} />
        </span>
        <div>
          <h3>{visit.visitorLabel}</h3>
          <p>
            <Monitor size={13} aria-hidden="true" />
            {visit.browser} · {visit.device}
          </p>
        </div>
        <span className={`admin-visit-status ${visit.status}`}>
          {visit.status === 'active'
            ? '최근 활성 화면'
            : visit.status === 'ended'
              ? '종료 신호 확인'
              : '마지막 활동 기준'}
        </span>
      </div>
      <dl className="admin-visit-meta">
        <div>
          <dt>접속 시각</dt>
          <dd>{timestamp(visit.startedAt)}</dd>
        </div>
        <div>
          <dt>{visit.endedAt ? '종료 신호 시각' : '마지막 활동 시각'}</dt>
          <dd>{timestamp(visit.endedAt ?? visit.lastSeenAt)}</dd>
          {!visit.endedAt && (
            <small>정확한 종료 시각은 확인되지 않았습니다.</small>
          )}
        </div>
        <div>
          <dt>활성 화면 체류</dt>
          <dd>{duration(visit.activeMs)}</dd>
        </div>
      </dl>
      <div className="admin-menu-history">
        <h4>
          열어본 메뉴 <span>{visit.views.length}회</span>
        </h4>
        {visit.views.length ? (
          <div className="admin-view-scroll">
            <table>
              <caption className="sr-only">
                방문자가 열어본 메뉴와 체류 시간
              </caption>
              <thead>
                <tr>
                  <th>메뉴</th>
                  <th>열어본 시각</th>
                  <th>마지막 활동</th>
                  <th>활성 체류</th>
                </tr>
              </thead>
              <tbody>
                {visit.views.map((view, index) => (
                  <tr key={view.id}>
                    <td>
                      <span className="admin-view-number">{index + 1}</span>
                      <strong>
                        {ANALYTICS_MENU_NAMES[view.menu] ?? '기타 메뉴'}
                      </strong>
                    </td>
                    <td>{timestamp(view.enteredAt)}</td>
                    <td>
                      {timestamp(view.endedAt ?? view.lastSeenAt)}
                      <small>
                        {view.endedAt
                          ? '종료 신호'
                          : view.active
                            ? '활성 화면'
                            : '활동 중지'}
                      </small>
                    </td>
                    <td>{duration(view.activeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="admin-no-views">
            메뉴별 활동이 아직 전달되지 않았습니다.
          </p>
        )}
      </div>
    </Card>
  )
}

export default function AdminAnalytics({
  inquiries = false,
}: {
  inquiries?: boolean
}) {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [days, setDays] = useState<1 | 7 | 30>(1)
  const [page, setPage] = useState(1)
  const [report, setReport] = useState<AnalyticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const lastRequest = useRef(0)
  const errorRef = useRef<HTMLDivElement>(null)
  const expireSession = useCallback(() => {
    setReport(null)
    setSession({ configured: true, authenticated: false })
    setError('인증이 만료되었습니다. 다시 로그인해 주세요.')
  }, [])

  useEffect(() => {
    let active = true
    async function checkSession() {
      try {
        const response = await fetch('/api/admin/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) throw new Error('session_unavailable')
        const next = sessionData(await response.json())
        if (active) setSession(next)
      } catch {
        if (active)
          setError(
            '관리자 인증 상태를 확인하지 못했습니다. 잠시 후 이 페이지를 다시 열어 주세요.',
          )
      } finally {
        if (active) setChecking(false)
      }
    }
    void checkSession()
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])
  useEffect(() => {
    if (!session?.authenticated || inquiries) return
    let active = true
    setLoading(true)
    setError('')
    setReport(null)
    lastRequest.current = Date.now()
    async function getReport() {
      try {
        const response = await fetch(
          `/api/admin/analytics?days=${days}&page=${page}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
          },
        )
        if (response.status === 401) {
          if (active) expireSession()
          return
        }
        if (!response.ok) throw new Error('report_unavailable')
        const next = reportData(await response.json())
        if (active) setReport(next)
      } catch {
        if (active)
          setError(
            '방문 기록을 불러오지 못했습니다. 잠시 후 다시 이 페이지를 열어 주세요.',
          )
      } finally {
        if (active) setLoading(false)
      }
    }
    void getReport()
    return () => {
      active = false
    }
  }, [session?.authenticated, days, page, refresh, inquiries, expireSession])
  useEffect(() => {
    if (!session?.authenticated || inquiries) return
    const update = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastRequest.current >= 30000
      )
        setRefresh((value) => value + 1)
    }
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [session?.authenticated, inquiries])

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const submitted = password
    setPassword('')
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: submitted }),
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 429)
        throw new Error(
          '로그인 시도가 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.',
        )
      if (response.status === 401) throw new Error('비밀번호를 확인해 주세요.')
      if (!response.ok)
        throw new Error(
          '관리자 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        )
      const next = sessionData(await response.json())
      if (!next.authenticated) throw new Error('비밀번호를 확인해 주세요.')
      setDays(1)
      setPage(1)
      setSession(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }
  async function logout() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSRF-Token': session?.csrfToken ?? '' },
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok && response.status !== 401)
        throw new Error('logout_failed')
      setReport(null)
      setSession({
        configured: session?.configured ?? true,
        authenticated: false,
      })
      setPassword('')
    } catch {
      setError('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const errorNotice = error && (
    <div className="admin-error" role="alert" tabIndex={-1} ref={errorRef}>
      {error}
    </div>
  )
  if (checking)
    return (
      <div className="admin-loading" role="status">
        <LockKeyhole aria-hidden="true" />
        관리자 인증을 확인하는 중입니다.
      </div>
    )
  if (!session?.authenticated)
    return (
      <section className="admin-login-shell">
        <a className="admin-back" href="#overview">
          <ArrowLeft size={16} aria-hidden="true" />
          대시보드로 돌아가기
        </a>
        <Card className="admin-login-card">
          <img
            src={`${import.meta.env.BASE_URL}brand/jb-academy-shield.png`}
            alt="JB GOLF ACADEMY 방패 로고"
          />
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>관리자 로그인</h1>
          <p>
            {inquiries
              ? '문의와 인계 담당자를 확인하려면 로그인하세요.'
              : '방문 기록은 관리자 인증 후에만 확인할 수 있습니다.'}
          </p>
          {errorNotice}
          {session && !session.configured && (
            <p className="admin-unconfigured" role="status">
              관리자 인증 설정이 아직 준비되지 않았습니다.
            </p>
          )}
          <form onSubmit={(event) => void login(event)}>
            <label htmlFor="admin-password">관리자 비밀번호</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              required
              maxLength={128}
              disabled={busy || !session?.configured}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Button type="submit" disabled={busy || !session?.configured}>
              {busy ? '확인 중…' : '로그인'}
            </Button>
          </form>
          <small>
            비밀번호는 서버에서 확인하며 이 브라우저에 저장하지 않습니다.
          </small>
        </Card>
      </section>
    )

  const heading = (
    <section className="page-heading">
      <div>
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>
          {inquiries ? '문의·상담 현황' : '방문 기록'}
          <span>.</span>
        </h1>
        <p className="page-description">
          {inquiries
            ? '문의가 들어온 채널과 유입 경로, 인계 담당자를 기록합니다.'
            : '사이트 접속과 메뉴별 활동을 관리자만 확인합니다.'}
        </p>
      </div>
      <div className="admin-actions">
        <a className="admin-back" href="#overview">
          <ArrowLeft size={15} aria-hidden="true" />
          대시보드
        </a>
        <Button variant="outline" disabled={busy} onClick={() => void logout()}>
          <LogOut aria-hidden="true" />
          로그아웃
        </Button>
      </div>
    </section>
  )
  if (inquiries)
    return (
      <div className="admin-analytics">
        {heading}
        {errorNotice}
        <Suspense fallback={<p role="status">문의 목록을 여는 중입니다.</p>}>
          <InquiryWorkspace
            csrfToken={session.csrfToken!}
            onUnauthorized={expireSession}
          />
        </Suspense>
      </div>
    )
  return (
    <div className="admin-analytics">
      {heading}
      <div className="admin-private-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          로그인하지 않은 방문자는 익명 번호로 구분합니다. 체류 시간은 화면이
          활성화된 동안 전달된 기록이며, 종료 신호가 없으면 마지막 활동까지만
          표시합니다.
        </p>
      </div>
      {errorNotice}
      <div className="admin-toolbar">
        <label htmlFor="admin-days">
          조회 기간
          <select
            id="admin-days"
            value={days}
            onChange={(event) => {
              setPage(1)
              setDays(Number(event.target.value) as 1 | 7 | 30)
            }}
          >
            <option value={1}>오늘</option>
            <option value={7}>최근 7일</option>
            <option value={30}>최근 30일</option>
          </select>
        </label>
        <span>
          한국 표준시 ·{' '}
          {report ? `확인 ${timestamp(report.updatedAt)}` : '기록 확인 중'}
        </span>
      </div>
      {loading ? (
        <div className="admin-loading" role="status">
          방문 기록을 불러오는 중입니다.
        </div>
      ) : report ? (
        <>
          <section className="admin-stats" aria-label="방문 통계">
            <Card>
              <span>
                <Eye aria-hidden="true" size={16} />
                접속
              </span>
              <strong>
                {report.totalVisits.toLocaleString('ko-KR')}
                <small>회</small>
              </strong>
            </Card>
            <Card>
              <span>
                <Users aria-hidden="true" size={16} />
                익명 방문자
              </span>
              <strong>
                {report.totalVisitors.toLocaleString('ko-KR')}
                <small>명</small>
              </strong>
            </Card>
            <Card>
              <span>
                <Clock3 aria-hidden="true" size={16} />
                활성 화면 체류
              </span>
              <strong className="admin-duration-total">
                {duration(report.totalActiveMs)}
              </strong>
            </Card>
          </section>
          {report.visits.length ? (
            <section className="admin-visit-list" aria-label="방문별 상세 기록">
              <div className="admin-list-heading">
                <h2>접속 내역</h2>
                <span>{report.totalVisits.toLocaleString('ko-KR')}건</span>
              </div>
              {report.visits.map((visit) => (
                <VisitRecord key={visit.id} visit={visit} />
              ))}
            </section>
          ) : (
            <Card className="admin-empty">
              <Clock3 aria-hidden="true" />
              <h2>아직 방문 기록이 없습니다</h2>
              <p>기능이 적용된 이후의 방문부터 기록됩니다.</p>
            </Card>
          )}
          {report.totalPages > 1 && (
            <nav className="admin-pagination" aria-label="방문 기록 페이지">
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                이전
              </Button>
              <span>
                {page} / {report.totalPages}
              </span>
              <Button
                variant="outline"
                disabled={page >= report.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                다음
              </Button>
            </nav>
          )}
        </>
      ) : (
        !error && (
          <div className="admin-loading" role="status">
            방문 기록을 확인하고 있습니다.
          </div>
        )
      )}
    </div>
  )
}
