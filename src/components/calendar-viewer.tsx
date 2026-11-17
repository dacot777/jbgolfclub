import { useCallback, useState } from 'react'
import ContentCalendar from './content-calendar'

export default function CalendarViewer({ token }: { token: string }) {
  const [expired, setExpired] = useState(false)
  const unavailable = useCallback(() => setExpired(true), [])
  const readFeed = useCallback(
    (month: string, signal: AbortSignal) =>
      fetch('/api/calendar/view?month=' + encodeURIComponent(month), {
        headers: { Authorization: 'Bearer ' + token },
        credentials: 'same-origin',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal,
      }),
    [token],
  )
  return (
    <div className="calendar-viewer">
      <header>
        <img
          src={import.meta.env.BASE_URL + 'brand/jb-academy-shield.png'}
          alt=""
        />
        JB GOLF ACADEMY <span>캘린더 열람</span>
      </header>
      <main>
        {expired || !/^[A-Za-z0-9_-]{43}$/.test(token) ? (
          <section className="calendar-link-expired">
            <h1>열람 링크를 확인해 주세요</h1>
            <p>
              링크가 만료되었거나 공유가 해제되었습니다. 담당자에게 새 링크를
              요청하세요.
            </p>
          </section>
        ) : (
          <ContentCalendar
            csrfToken=""
            onUnauthorized={unavailable}
            readFeed={readFeed}
          />
        )}
      </main>
    </div>
  )
}
