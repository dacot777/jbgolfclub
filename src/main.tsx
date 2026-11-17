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
function Workspace() {
  const [hash, setHash] = React.useState(window.location.hash)
  const calendar =
    __INSTAGRAM_BACKEND__ &&
    (hash === '#calendar' || hash.startsWith('#calendar-view/'))
  React.useEffect(() => {
    document.title = calendar
      ? '콘텐츠 캘린더 · JB GOLF'
      : 'JB GOLF ACADEMY · 광고 성과'
  }, [calendar])
  React.useEffect(() => {
    const changed = () => setHash(window.location.hash)
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
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
