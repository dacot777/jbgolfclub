import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import '@/admin-analytics.css'

const ContentCalendar = lazy(() => import('./content-calendar'))
const InquiryWorkspace = lazy(() => import('./inquiry-workspace'))

function readPublicMonth(month: string, signal: AbortSignal) {
  return fetch('/api/calendar?month=' + encodeURIComponent(month), {
    credentials: 'omit',
    cache: 'no-store',
    signal,
  })
}

export default function StaffWorkspace({
  page,
}: {
  page: 'calendar' | 'inquiries'
}) {
  const [csrf, setCsrf] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [copyResult, setCopyResult] = useState('')
  const expired = useCallback(() => setCsrf(''), [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    async function check() {
      try {
        const res = await fetch('/api/staff/session', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        })
        if (!res.ok) throw new Error()
        const session = await res.json()
        if (!controller.signal.aborted)
          setCsrf(
            session.authenticated && typeof session.csrfToken === 'string'
              ? session.csrfToken
              : '',
          )
      } catch {
        if (!controller.signal.aborted)
          setError('이 기기의 담당자 연결 상태를 확인하지 못했습니다.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void check()
    return () => controller.abort()
  }, [attempt])
  async function disconnect() {
    setLoggingOut(true)
    try {
      const res = await fetch('/api/staff/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSRF-Token': csrf },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok && res.status !== 401) throw new Error()
      setCsrf('')
      setError('')
    } catch {
      setError('연결 해제를 확인하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setLoggingOut(false)
    }
  }
  async function copyCalendar() {
    const url = window.location.origin + window.location.pathname + '#calendar'
    try {
      await navigator.clipboard.writeText(url)
      setCopyResult('캘린더 주소를 복사했습니다.')
    } catch {
      setCopyResult(url)
    }
  }
  const disconnectButton = csrf && (
    <Button
      variant="ghost"
      disabled={loggingOut}
      onClick={() => void disconnect()}
    >
      이 기기 연결 해제
    </Button>
  )
  return (
    <>
      {error && (
        <div className="admin-error" role="alert">
          {error}{' '}
          <Button variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
            다시 확인
          </Button>
        </div>
      )}
      <Suspense fallback={<p role="status">페이지를 여는 중입니다.</p>}>
        {page === 'calendar' ? (
          <>
            <div className="calendar-owner-actions">
              {copyResult && <span role="status">{copyResult}</span>}
              <Button variant="outline" onClick={() => void copyCalendar()}>
                캘린더 주소 복사
              </Button>
              {disconnectButton}
            </div>
            <ContentCalendar
              key={csrf ? 'staff' : 'public'}
              csrfToken={csrf}
              onUnauthorized={expired}
              readFeed={csrf ? undefined : readPublicMonth}
            />
          </>
        ) : (
          <div className="admin-analytics">
            <section className="page-heading">
              <div>
                <h1>
                  문의·상담 현황<span>.</span>
                </h1>
                {csrf && (
                  <p className="page-description">
                    문의가 들어온 채널과 유입 경로, 인계 담당자를 기록합니다.
                  </p>
                )}
              </div>
              {disconnectButton}
            </section>
            {csrf ? (
              <InquiryWorkspace csrfToken={csrf} onUnauthorized={expired} />
            ) : (
              <p role="status">
                {loading
                  ? '이 기기의 연결을 확인하고 있습니다.'
                  : '문의에는 이름과 연락처가 포함되어 있어요. 담당자 기기 연결 링크를 이 브라우저에서 한 번 열면 문의를 확인하고 기록할 수 있습니다.'}
              </p>
            )}
          </div>
        )}
      </Suspense>
    </>
  )
}
