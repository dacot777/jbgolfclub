import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/noto-sans-kr'
import './index.css'
import './connection.css'
import App from './App'
import { ConnectionLegalPage } from './components/connection-legal-page'
import './apple-workspace.css'

const CalendarViewer = React.lazy(() => import('./components/calendar-viewer'))
const devicePrefix = '#staff-device/'
function readRoute() {
  const hash = window.location.hash
  if (__INSTAGRAM_BACKEND__ && hash.startsWith(devicePrefix))
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search + '#calendar',
    )
  return hash
}
const initialRoute = readRoute()

async function activateDevice(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  const res = await fetch('/api/staff/activate', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(12000),
  })
  if (res.ok) return (await res.json()).authenticated === true
  const session = await fetch('/api/staff/session', {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  return session.ok && (await session.json()).authenticated === true
}

function StaffActivation({
  token,
  finish,
}: {
  token: string
  finish: () => void
}) {
  const request = React.useRef<Promise<boolean> | null>(null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => {
    let active = true
    request.current ??= activateDevice(token).catch(() => false)
    void request.current.then((ok) => {
      if (!active) return
      if (ok) finish()
      else setFailed(true)
    })
    return () => {
      active = false
    }
  }, [token, finish])
  return (
    <main className="calendar-link-expired">
      <h1>담당자 기기 연결</h1>
      {failed ? (
        <>
          <p role="alert">
            이 기기를 연결하지 못했습니다. 링크가 만료되었거나 이미 사용되었다면
            새 연결 링크를 열어 주세요.
          </p>
          <button type="button" onClick={finish}>
            콘텐츠 캘린더 열기
          </button>
        </>
      ) : (
        <p role="status">이 브라우저를 담당자 기기로 연결하고 있습니다.</p>
      )}
    </main>
  )
}

function Workspace() {
  const [hash, setHash] = React.useState(initialRoute)
  const finish = React.useCallback(() => setHash('#calendar'), [])
  const calendar =
    __INSTAGRAM_BACKEND__ &&
    (hash === '#calendar' || hash.startsWith('#calendar-view/'))
  React.useEffect(() => {
    document.title = calendar
      ? '콘텐츠 캘린더 · JB GOLF'
      : 'JB GOLF ACADEMY · 광고 성과'
  }, [calendar])
  React.useEffect(() => {
    const changed = () => setHash(readRoute())
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  if (__INSTAGRAM_BACKEND__ && hash.startsWith(devicePrefix))
    return (
      <StaffActivation
        key={hash}
        token={hash.slice(devicePrefix.length)}
        finish={finish}
      />
    )
  if (__INSTAGRAM_BACKEND__ && hash.startsWith('#calendar-view/'))
    return (
      <React.Suspense fallback={<p role="status">캘린더를 여는 중입니다.</p>}>
        <CalendarViewer
          key={hash}
          token={hash.slice('#calendar-view/'.length)}
        />
      </React.Suspense>
    )
  return <App />
}
const legal =
  window.location.pathname === '/privacy' ||
  window.location.pathname === '/data-deletion'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {legal ? (
      <ConnectionLegalPage
        deletion={window.location.pathname === '/data-deletion'}
      />
    ) : (
      <Workspace />
    )}
  </React.StrictMode>,
)
