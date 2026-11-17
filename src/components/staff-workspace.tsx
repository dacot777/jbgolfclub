import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { activateStaffDevice, readStaffSession } from '@/lib/staff-device'
import type { ReviewedAd } from '@/lib/reviewed-performance-types'
import '@/admin-analytics.css'

const ContentCalendar = lazy(() => import('./content-calendar'))
const InquiryWorkspace = lazy(() => import('./inquiry-workspace'))

function readPublicMonth(month: string, signal: AbortSignal) {
  return fetch(
    '/api/calendar' +
      (month === 'latest' ? '/posts' : '?month=' + encodeURIComponent(month)),
    {
      credentials: 'omit',
      cache: 'no-store',
      signal,
    },
  )
}

function InquiryAccess({
  onConnected,
  onCheck,
  checking,
}: {
  onConnected: (csrf: string) => void
  onCheck: () => void
  checking: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const choose = useRef<HTMLButtonElement>(null)
  const [connecting, setConnecting] = useState(false)
  const [notice, setNotice] = useState('')
  async function connect(file: File) {
    setNotice('')
    setConnecting(true)
    try {
      // Read only our launcher's exact destination as text; never open or upload selected HTML.
      const match =
        file.size <= 16384 && /\.html?$/i.test(file.name)
          ? /<a\s+href=["']https:\/\/jbgolf-connection\.jbgolfacademy\.workers\.dev\/#staff-device\/([\w-]{43})["']/i.exec(
              await file.text(),
            )
          : null
      if (!match) {
        setNotice(
          '담당자 연결 파일을 확인해 주세요. 파일 이름은 운영-기기-연결.html입니다.',
        )
        return
      }
      const csrf = await activateStaffDevice(match[1])
      if (csrf) onConnected(csrf)
      else
        setNotice(
          '사용 기한이 지났거나 다른 브라우저에서 이미 사용한 파일입니다. 연결했던 브라우저를 열거나 새 연결 파일을 받아 주세요.',
        )
    } catch (error) {
      setNotice(
        error instanceof Error && error.message === 'staff_cookie_unavailable'
          ? '이 브라우저에 연결이 저장되지 않았습니다. 이 사이트의 쿠키를 허용한 뒤 새 연결 파일을 선택해 주세요.'
          : '연결 결과를 확인하지 못했습니다. 네트워크를 확인하고 연결 상태를 다시 확인해 주세요.',
      )
    } finally {
      setConnecting(false)
      choose.current?.focus()
    }
  }
  return (
    <Card className="max-w-2xl gap-4 px-6">
      <h2 className="text-lg font-semibold">이 브라우저에서 문의 열기</h2>
      <p>
        고객 이름과 연락처는 담당자에게만 보입니다. 업무용 PC에 발급된 연결
        파일을 한 번 선택하면 이 창에 문의 목록이 열립니다.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={choose}
          aria-busy={connecting}
          onClick={() => !connecting && input.current?.click()}
        >
          {connecting ? '연결 중…' : '연결 파일 선택'}
        </Button>
        <input
          type="file"
          accept=".html,.htm"
          ref={input}
          hidden
          aria-label="담당자 연결 파일"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void connect(file)
          }}
        />
        <Button
          variant="outline"
          disabled={checking || connecting}
          onClick={onCheck}
        >
          {checking ? '확인 중…' : '연결 상태 다시 확인'}
        </Button>
      </div>
      {notice && (
        <p className="text-sm" role="alert">
          {notice}
        </p>
      )}
      <details className="text-sm leading-relaxed">
        <summary className="cursor-pointer">
          연결 파일 위치와 브라우저 안내
        </summary>
        <p className="mt-2">
          Windows 파일 선택 창의 ‘파일 이름’에 아래 경로를 붙여 넣고 ‘열기’를
          누르세요.
        </p>
        <code className="break-all">
          %LOCALAPPDATA%\JBGolfWorkspace\운영-기기-연결.html
        </code>
        <p className="mt-2">
          이미 크롬에서 연결했다면 같은 크롬 프로필의 일반 창에서 문의·상담을
          여세요. 앱 안의 브라우저와 시크릿 창은 별도로 연결됩니다.
        </p>
      </details>
    </Card>
  )
}

export default function StaffWorkspace({
  page,
  reviewedAds,
}: {
  page: 'calendar' | 'instagram-posts' | 'inquiries'
  reviewedAds?: ReviewedAd[]
}) {
  const [csrf, setCsrf] = useState('')
  const [initialCheck, setInitialCheck] = useState(true)
  const [checking, setChecking] = useState(false)
  const pending = useRef<AbortController | null>(null)
  const [error, setError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [copyResult, setCopyResult] = useState('')
  const changeSession = useCallback((csrf: string) => {
    pending.current?.abort()
    pending.current = null
    setChecking(false)
    setInitialCheck(false)
    setError('')
    setCsrf(csrf)
  }, [])
  const expired = useCallback(() => changeSession(''), [changeSession])
  const check = useCallback(async () => {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setChecking(true)
    setError('')
    try {
      const next = await readStaffSession(controller.signal)
      if (!controller.signal.aborted) setCsrf(next)
    } catch {
      if (!controller.signal.aborted)
        setError('이 기기의 담당자 연결 상태를 확인하지 못했습니다.')
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null
        setChecking(false)
        setInitialCheck(false)
      }
    }
  }, [])
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'visible') void check()
    }
    void check()
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
      pending.current?.abort()
      pending.current = null
    }
  }, [check])
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
      changeSession('')
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
          <Button
            variant="ghost"
            disabled={checking}
            onClick={() => void check()}
          >
            다시 확인
          </Button>
        </div>
      )}
      <Suspense fallback={<p role="status">페이지를 여는 중입니다.</p>}>
        {page !== 'inquiries' ? (
          <>
            <div className="calendar-owner-actions">
              {page === 'calendar' && (
                <>
                  {copyResult && <span role="status">{copyResult}</span>}
                  <Button variant="outline" onClick={() => void copyCalendar()}>
                    캘린더 주소 복사
                  </Button>
                </>
              )}
              {disconnectButton}
            </div>
            <ContentCalendar
              key={page + (csrf ? '-staff' : '-public')}
              view={page === 'calendar' ? 'calendar' : 'gallery'}
              reviewedAds={reviewedAds}
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
            ) : initialCheck ? (
              <p role="status">
                이 브라우저의 담당자 연결을 확인하고 있습니다.
              </p>
            ) : (
              <InquiryAccess
                onConnected={changeSession}
                onCheck={check}
                checking={checking}
              />
            )}
          </div>
        )}
      </Suspense>
    </>
  )
}
