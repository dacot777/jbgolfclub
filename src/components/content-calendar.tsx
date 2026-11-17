import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Image as ImageIcon,
  Link2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  CALENDAR_ACCOUNTS,
  CALENDAR_LIMITS,
  type CalendarAccountStatus,
  type CalendarMonth,
  type CalendarPost,
  type CalendarSchedule,
  type CalendarScheduleInput,
} from '@/lib/calendar-types'
import '@/content-calendar.css'

type Account = (typeof CALENDAR_ACCOUNTS)[number]
type Filter = Account | 'all'
type Entry =
  | { type: 'post'; value: CalendarPost }
  | { type: 'plan'; value: CalendarSchedule }
type Panel =
  | { type: 'accounts' }
  | { type: 'day'; date: string }
  | {
      type: 'editor'
      original: CalendarSchedule | null
      id: string
      fromDay: string | null
    }
  | null
const accountLabels: Record<Account, string> = {
  jbgolfacademy: '아카데미',
  jbgolfclub_official: '골프클럽 공식',
  jbgolfclub_bundang: '골프클럽 분당',
}
const statusLabels: Record<CalendarAccountStatus['status'], string> = {
  setup_required: 'Instagram 앱 설정 필요',
  needs_connection: '계정 연결 필요',
  syncing: '게시물 수집 중',
  connected: '연결됨',
  error: '동기화 확인 필요',
}
const kindLabels = { post: '게시물', reel: '릴스' }
const api = '/api/admin/calendar'
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const longDay = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'UTC',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})
const weekdays = ['일', '월', '화', '수', '목', '금', '토']
function utcDate(date: string) {
  return new Date(date + 'T12:00:00Z')
}
function shiftMonth(month: string, delta: number) {
  const date = utcDate(month + '-01')
  date.setUTCMonth(date.getUTCMonth() + delta)
  return date.toISOString().slice(0, 7)
}
function calendarDates(month: string) {
  const start = utcDate(month + '-01')
  const weekday = start.getUTCDay()
  const next = utcDate(shiftMonth(month, 1) + '-01')
  next.setUTCDate(0)
  const count = Math.ceil((weekday + next.getUTCDate()) / 7) * 7
  start.setUTCDate(1 - weekday)
  return Array.from({ length: count }, (_, index) =>
    new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10),
  )
}
function displayMonth(month: string) {
  const [y, m] = month.split('-')
  return y + '년 ' + Number(m) + '월'
}
function entryKey(entry: Entry) {
  return entry.type + '-' + entry.value.account + '-' + entry.value.id
}
function EntryIcon({
  kind,
  size = 14,
}: {
  kind: 'post' | 'reel'
  size?: number
}) {
  return kind === 'reel' ? (
    <Clapperboard size={size} aria-hidden="true" />
  ) : (
    <ImageIcon size={size} aria-hidden="true" />
  )
}
function Thumbnail({ entry }: { entry: Entry }) {
  const [failed, setFailed] = useState('')
  const url = entry.type === 'post' ? entry.value.thumbnailUrl : null
  return (
    <span
      className={'cc-thumb ' + (entry.type === 'plan' ? 'cc-thumb-plan' : '')}
    >
      {url && failed !== url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : entry.type === 'plan' ? (
        <CalendarDays aria-hidden="true" size={17} />
      ) : (
        <EntryIcon kind={entry.value.kind} size={18} />
      )}
    </span>
  )
}
function EntryList({
  entries,
  onEdit,
  showStatus = false,
}: {
  entries: Entry[]
  onEdit?: (plan: CalendarSchedule) => void
  showStatus?: boolean
}) {
  return (
    <ul className="cc-entry-list">
      {entries.map((entry) => {
        const item = entry.value
        const body = (
          <>
            <Thumbnail entry={entry} />
            <span className="cc-row-detail">
              <strong>{item.title || kindLabels[item.kind]}</strong>
              <small>
                {Number(item.date.slice(5, 7))}월 {Number(item.date.slice(8))}일
                {item.time ? ' ' + item.time : ''} ·{' '}
                {accountLabels[item.account]} · {kindLabels[item.kind]}
                {showStatus &&
                  (entry.type === 'post' ? ' · 게시됨' : ' · 일정')}
              </small>
            </span>
          </>
        )
        return (
          <li key={entryKey(entry)}>
            {entry.type === 'post' ? (
              <a
                href={entry.value.permalink}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={item.title + ' Instagram에서 보기'}
              >
                {body}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            ) : !onEdit ? (
              <div className="cc-static-row">{body}</div>
            ) : (
              <button
                type="button"
                onClick={() => onEdit(entry.value)}
                aria-label={item.title + ' 일정 수정'}
              >
                {body}
                <Pencil size={15} aria-hidden="true" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
function AgendaList({
  entries,
  onEdit,
}: {
  entries: Entry[]
  onEdit?: (plan: CalendarSchedule) => void
}) {
  return (
    <>
      <EntryList entries={entries.slice(0, 5)} onEdit={onEdit} />
      {entries.length > 5 && (
        <details className="cc-rest">
          <summary>나머지 {entries.length - 5}개 보기</summary>
          <EntryList entries={entries.slice(5)} onEdit={onEdit} />
        </details>
      )}
    </>
  )
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="cc-error" role="alert">
      {children}
    </p>
  )
}

export default function ContentCalendar({
  csrfToken,
  onUnauthorized,
  readFeed,
}: {
  csrfToken: string
  onUnauthorized: () => void
  readFeed?: (month: string, signal: AbortSignal) => Promise<Response>
}) {
  const today = dateFormat.format(new Date())
  const [month, setMonth] = useState(today.slice(0, 7))
  const [filter, setFilter] = useState<Filter>('all')
  const [data, setData] = useState<CalendarMonth | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [panel, setPanel] = useState<Panel>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState<CalendarScheduleInput | null>(null)
  const writeLock = useRef(false)
  const opener = useRef<HTMLElement | null>(null)
  const defaultFocus = useRef<HTMLButtonElement>(null)
  const session = useRef<AbortController | null>(null)
  const unauthorized = useRef(onUnauthorized)
  useEffect(() => {
    unauthorized.current = onUnauthorized
  }, [onUnauthorized])
  useEffect(() => {
    const controller = new AbortController()
    session.current = controller
    return () => {
      controller.abort()
      session.current = null
    }
  }, [csrfToken])
  const expire = useCallback(() => {
    session.current?.abort()
    setData(null)
    setPanel(null)
    setDraft(null)
    setNotice('')
    setActionError('')
    unauthorized.current()
  }, [])
  useEffect(() => {
    const active = session.current
    if (!active || active.signal.aborted) return
    const controller = new AbortController()
    setError('')
    async function read() {
      try {
        const signal = AbortSignal.any([
          controller.signal,
          active!.signal,
          AbortSignal.timeout(15000),
        ])
        const response = readFeed
          ? await readFeed(month, signal)
          : await fetch(api + '?month=' + month, {
              credentials: 'same-origin',
              cache: 'no-store',
              signal,
            })
        if (controller.signal.aborted || active!.signal.aborted) return
        if (response.status === 401 || response.status === 403) {
          expire()
          return
        }
        if (!response.ok) throw new Error()
        const result: CalendarMonth = await response.json()
        if (
          result.month !== month ||
          !Array.isArray(result.posts) ||
          !Array.isArray(result.accounts) ||
          !Array.isArray(result.schedules)
        )
          throw new Error()
        if (!controller.signal.aborted && !active!.signal.aborted)
          setData(result)
      } catch {
        if (!controller.signal.aborted && !active!.signal.aborted)
          setError('달력을 불러오지 못했습니다.')
      }
    }
    void read()
    return () => controller.abort()
  }, [month, reload, csrfToken, expire, readFeed])
  useEffect(() => {
    if (readFeed) return
    const params = new URLSearchParams(location.search)
    const result = params.get('calendar_instagram')
    if (!result) return
    setNotice(
      result === 'connected'
        ? 'Instagram 계정을 연결했습니다.'
        : result === 'different_instagram_account'
          ? '선택한 Instagram 계정으로 다시 로그인해 주세요.'
          : result === 'authorization_cancelled'
            ? 'Instagram 연결을 취소했습니다.'
            : 'Instagram 계정을 연결하지 못했습니다.',
    )
    const url = new URL(location.href)
    url.searchParams.delete('calendar_instagram')
    history.replaceState(history.state, '', url)
  }, [readFeed])
  useEffect(() => {
    let last = Date.now()
    const refresh = () => {
      if (
        document.visibilityState !== 'visible' ||
        writeLock.current ||
        Date.now() - last < 60000
      )
        return
      last = Date.now()
      setReload((n) => n + 1)
    }
    const timer = window.setInterval(refresh, 300000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const current = data?.month === month ? data : null
  const entries = useMemo(() => {
    const result: Entry[] = []
    for (const value of current?.posts ?? [])
      if (filter === 'all' || filter === value.account)
        result.push({ type: 'post', value })
    for (const value of current?.schedules ?? [])
      if (filter === 'all' || filter === value.account)
        result.push({ type: 'plan', value })
    result.sort(
      (a, b) =>
        a.value.date.localeCompare(b.value.date) ||
        (a.value.time ?? '').localeCompare(b.value.time ?? '') ||
        a.value.title.localeCompare(b.value.title),
    )
    return result
  }, [current, filter])
  const perDay = useMemo(() => {
    const result = new Map<string, Entry[]>()
    for (const entry of entries) {
      const date = entry.value.date
      const rows = result.get(date)
      if (rows) rows.push(entry)
      else result.set(date, [entry])
    }
    return result
  }, [entries])
  const published = entries.filter((row) => row.type === 'post').reverse()
  const plans = entries.filter((row) => row.type === 'plan')
  const dates = calendarDates(month)
  const activeAccounts = (current?.accounts ?? []).filter(
    (row) => filter === 'all' || row.account === filter,
  )
  const incompleteAccounts = activeAccounts.filter(
    (row) => row.status !== 'connected',
  )
  const missing = incompleteAccounts.length > 0
  function open(next: NonNullable<Panel>) {
    if (!panel)
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    setActionError('')
    setConfirmDelete(false)
    setConflict(false)
    setPanel(next)
  }
  function editor(date: string, item?: CalendarSchedule) {
    if (readFeed) return
    const initial: CalendarScheduleInput = item
      ? {
          account: item.account,
          kind: item.kind,
          title: item.title,
          date: item.date,
          time: item.time,
          note: item.note,
        }
      : {
          account: filter === 'all' ? CALENDAR_ACCOUNTS[0] : filter,
          date,
          kind: 'post',
          title: '',
          time: null,
          note: '',
        }
    setDraft(initial)
    open({
      type: 'editor',
      original: item ?? null,
      id: item?.id ?? crypto.randomUUID(),
      fromDay: panel?.type === 'day' ? panel.date : null,
    })
  }
  function dismiss() {
    if (writeLock.current) return
    if (confirmDelete) {
      setConfirmDelete(false)
      setActionError('')
      return
    }
    if (panel?.type === 'editor' && panel.fromDay)
      setPanel({ type: 'day', date: panel.fromDay })
    else setPanel(null)
    setDraft(null)
    setActionError('')
    setConflict(false)
  }
  async function write(action: 'save' | 'delete') {
    if (
      readFeed ||
      panel?.type !== 'editor' ||
      !draft ||
      writeLock.current ||
      conflict
    )
      return
    const active = session.current
    if (!active || active.signal.aborted) return
    writeLock.current = true
    setBusy(true)
    setActionError('')
    const original = panel.original
    try {
      const method = action === 'delete' ? 'DELETE' : original ? 'PUT' : 'POST'
      const path =
        api +
        '/schedules' +
        (original ? '/' + encodeURIComponent(original.id) : '')
      const body =
        action === 'delete'
          ? { version: original!.version }
          : {
              ...draft,
              title: draft.title.trim(),
              ...(original ? { version: original.version } : { id: panel.id }),
            }
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(15000)]),
      })
      if (active.signal.aborted) return
      if (res.status === 401 || res.status === 403) {
        expire()
        return
      }
      if (res.status === 409 || res.status === 404) {
        setConflict(true)
        setConfirmDelete(false)
        setActionError(
          '다른 곳에서 일정이 변경되었습니다. 최신 일정을 확인해 주세요.',
        )
        return
      }
      if (!res.ok) throw new Error()
      const result = await res.json()
      if (active.signal.aborted) return
      if (
        (action === 'save' && result.item?.id !== panel.id) ||
        (action === 'delete' && result.deleted !== true)
      )
        throw new Error()
      const targetMonth = action === 'save' ? draft.date.slice(0, 7) : month
      setData((prev) =>
        prev
          ? {
              ...prev,
              schedules: [
                ...prev.schedules.filter((item) => item.id !== panel.id),
                ...(action === 'save' && draft.date.startsWith(prev.month + '-')
                  ? [result.item as CalendarSchedule]
                  : []),
              ],
            }
          : prev,
      )
      if (action === 'save' && filter !== 'all' && draft.account !== filter)
        setFilter(draft.account)
      setMonth(targetMonth)
      setReload((n) => n + 1)
      setPanel(null)
      setDraft(null)
      setConfirmDelete(false)
      setNotice(
        action === 'delete' ? '일정을 삭제했습니다.' : '일정을 저장했습니다.',
      )
    } catch {
      if (!active.signal.aborted)
        setActionError(
          action === 'delete'
            ? '삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.'
            : '저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.',
        )
    } finally {
      writeLock.current = false
      if (!active.signal.aborted) setBusy(false)
    }
  }
  async function connect(account: Account) {
    const active = session.current
    if (readFeed || !active || active.signal.aborted || writeLock.current)
      return
    writeLock.current = true
    setBusy(true)
    setActionError('')
    try {
      const res = await fetch(api + '/instagram/connect/' + account, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSRF-Token': csrfToken },
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(12000)]),
      })
      if (active.signal.aborted) return
      if (res.status === 401 || res.status === 403) {
        expire()
        return
      }
      if (!res.ok) throw new Error()
      const { url } = await res.json()
      if (active.signal.aborted) return
      const dest = new URL(url)
      if (
        dest.origin !== 'https://www.instagram.com' ||
        !/^\/oauth\/authorize\/?$/.test(dest.pathname)
      )
        throw new Error()
      location.assign(dest.href)
    } catch {
      if (!active.signal.aborted)
        setActionError(
          'Instagram 로그인을 열지 못했습니다. 계정 연결 설정을 확인해 주세요.',
        )
    } finally {
      writeLock.current = false
      if (!active.signal.aborted) setBusy(false)
    }
  }
  function setField<K extends keyof CalendarScheduleInput>(
    key: K,
    value: CalendarScheduleInput[K],
  ) {
    if (writeLock.current) return
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    setActionError('')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void write('save')
  }
  function dayKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = (
      { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 } as Record<
        string,
        number
      >
    )[event.key]
    if (!delta) return
    event.preventDefault()
    const id = dates[index + delta]
    if (id?.startsWith(month)) document.getElementById('cc-day-' + id)?.focus()
  }
  const dailyEntries =
    panel?.type === 'day' ? (perDay.get(panel.date) ?? []) : []
  return (
    <section className="cc" aria-label="인스타그램 콘텐츠 캘린더">
      <header className="cc-header">
        <h1>콘텐츠 캘린더</h1>
        {!readFeed && (
          <button
            ref={defaultFocus}
            type="button"
            className="cc-primary"
            onClick={() =>
              editor(today.startsWith(month) ? today : month + '-01')
            }
          >
            <Plus size={17} aria-hidden="true" />
            일정 등록
          </button>
        )}
      </header>
      <div className="cc-toolbar">
        <div className="cc-month">
          <h2 aria-live="polite">{displayMonth(month)}</h2>
          <div className="cc-switch-month">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setMonth(today.slice(0, 7))}>
              오늘
            </button>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        {!readFeed && (
          <button
            type="button"
            className="cc-manage"
            onClick={() => open({ type: 'accounts' })}
          >
            <Link2 size={16} aria-hidden="true" />
            계정 관리
          </button>
        )}
      </div>
      <div className="cc-filter" role="group" aria-label="표시할 계정">
        <button
          type="button"
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          전체 계정
        </button>
        {CALENDAR_ACCOUNTS.map((account) => (
          <button
            type="button"
            key={account}
            title={'@' + account}
            aria-label={accountLabels[account]}
            aria-pressed={filter === account}
            onClick={() => setFilter(account)}
          >
            <span className="cc-account-full">{accountLabels[account]}</span>
            <span className="cc-account-short" aria-hidden="true">
              {accountLabels[account].replace('골프클럽 ', '')}
            </span>
          </button>
        ))}
      </div>
      {notice && (
        <p className="cc-notice" role="status">
          {notice}
          <button
            aria-label="알림 닫기"
            type="button"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </p>
      )}
      {error && (
        <Notice>
          {error}{' '}
          <button className="cc-text" onClick={() => setReload((n) => n + 1)}>
            다시 불러오기
          </button>
        </Notice>
      )}
      {!current && !error && (
        <p className="cc-loading" role="status">
          이달의 콘텐츠를 불러오는 중입니다.
        </p>
      )}
      {current && missing && (
        <p className="cc-sync-note">
          {activeAccounts.every(
            (a) =>
              a.status === 'setup_required' || a.status === 'needs_connection',
          )
            ? 'Instagram 계정을 연결하면 게시물과 릴스가 달력에 표시됩니다.'
            : incompleteAccounts
                .map(
                  ({ account, status }) =>
                    accountLabels[account] + ' · ' + statusLabels[status],
                )
                .join(' / ')}{' '}
          {!readFeed && (
            <button
              type="button"
              className="cc-text"
              onClick={() => open({ type: 'accounts' })}
            >
              연결 상태 보기
            </button>
          )}
        </p>
      )}
      <div
        className="cc-calendar"
        role="group"
        aria-label={displayMonth(month) + ' 콘텐츠 달력'}
      >
        <div className="cc-weekdays" aria-hidden="true">
          {weekdays.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div className="cc-grid">
          {dates.map((date, index) => {
            const dateNum = Number(date.slice(-2))
            if (!date.startsWith(month))
              return (
                <div className="cc-outside" key={date} aria-hidden="true">
                  {dateNum}
                </div>
              )
            const items = perDay.get(date) ?? []
            const previews =
              items.length <= 2
                ? items
                : [
                    ...items.filter(
                      (item) => item.type === 'post' && item.value.thumbnailUrl,
                    ),
                    ...items.filter(
                      (item) =>
                        item.type === 'plan' || !item.value.thumbnailUrl,
                    ),
                  ].slice(0, 2)
            return (
              <button
                type="button"
                id={'cc-day-' + date}
                className={'cc-day' + (date === today ? ' cc-today' : '')}
                key={date}
                aria-label={
                  date +
                  (date === today ? ' 오늘' : '') +
                  ', 콘텐츠 ' +
                  items.length +
                  '개'
                }
                onKeyDown={(e) => dayKeys(e, index)}
                onClick={() => open({ type: 'day', date })}
              >
                <span className="cc-day-top">
                  <span
                    className="cc-number"
                    aria-current={date === today ? 'date' : undefined}
                  >
                    {dateNum}
                  </span>
                  {items.length > 2 && (
                    <span className="cc-more">+{items.length - 2}</span>
                  )}
                </span>
                <span className="cc-previews">
                  {previews.map((entry) => (
                    <span
                      className={
                        'cc-preview ' +
                        (entry.type === 'post' ? 'cc-published' : 'cc-planned')
                      }
                      key={entryKey(entry)}
                    >
                      <Thumbnail entry={entry} />
                      <span className="cc-compact-caption">
                        {entry.type === 'plan'
                          ? '일정'
                          : accountLabels[entry.value.account].replace(
                              '골프클럽 ',
                              '',
                            )}
                      </span>
                      <span className="cc-preview-copy">
                        <strong>
                          {entry.value.title || kindLabels[entry.value.kind]}
                        </strong>
                        <small>
                          {accountLabels[entry.value.account]} ·{' '}
                          {entry.type === 'plan'
                            ? '예정'
                            : kindLabels[entry.value.kind]}
                        </small>
                      </span>
                    </span>
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {current && (
        <div className="cc-agenda">
          <section>
            <h2>
              게시된 콘텐츠 <span>{published.length}</span>
            </h2>
            {published.length ? (
              <AgendaList
                entries={published}
                onEdit={readFeed ? undefined : (p) => editor(p.date, p)}
              />
            ) : (
              <p>
                {missing
                  ? '아직 가져온 게시물이 없습니다.'
                  : '이달에 가져온 게시물이 없습니다.'}
              </p>
            )}
          </section>
          <section>
            <h2>
              등록한 일정 <span>{plans.length}</span>
            </h2>
            {plans.length ? (
              <AgendaList
                entries={plans}
                onEdit={readFeed ? undefined : (p) => editor(p.date, p)}
              />
            ) : (
              <p>이달에 등록한 일정이 없습니다.</p>
            )}
          </section>
        </div>
      )}
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) dismiss()
        }}
      >
        {panel && (
          <DialogContent
            className="cc-dialog"
            showCloseButton={false}
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              ;(opener.current?.isConnected
                ? opener.current
                : defaultFocus.current
              )?.focus({ preventScroll: true })
            }}
          >
            <div className="cc-dialog-head">
              <DialogTitle>
                {panel.type === 'accounts'
                  ? 'Instagram 계정 관리'
                  : panel.type === 'day'
                    ? longDay.format(utcDate(panel.date))
                    : confirmDelete
                      ? '일정 삭제'
                      : panel.original
                        ? '일정 수정'
                        : '일정 등록'}
              </DialogTitle>
              <button
                type="button"
                className="cc-close"
                aria-label="닫기"
                disabled={busy}
                onClick={dismiss}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {panel.type === 'accounts' && (
              <>
                <div className="cc-dialog-body cc-accounts">
                  {(current?.accounts ?? []).map(
                    ({ account, status, lastSyncedAt }) => (
                      <div key={account} className="cc-account">
                        <div>
                          <strong>{accountLabels[account]}</strong>
                          <a
                            href={'https://www.instagram.com/' + account + '/'}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            @{account}
                            <ArrowUpRight size={13} aria-hidden="true" />
                          </a>
                          <small>
                            {statusLabels[status]}
                            {lastSyncedAt
                              ? ' · 최근 수집 ' +
                                new Intl.DateTimeFormat('ko-KR', {
                                  timeZone: 'Asia/Seoul',
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }).format(new Date(lastSyncedAt))
                              : ''}
                          </small>
                        </div>
                        {(status === 'needs_connection' ||
                          status === 'error') && (
                          <button
                            type="button"
                            className="cc-outline"
                            disabled={busy}
                            onClick={() => void connect(account)}
                          >
                            {status === 'error' ? '다시 연결' : '연결'}
                          </button>
                        )}
                      </div>
                    ),
                  )}
                  {!current && (
                    <p>{error || '계정 상태를 불러오는 중입니다.'}</p>
                  )}
                  {current?.accounts.some(
                    (a) => a.status === 'setup_required',
                  ) && (
                    <details className="cc-account-setup">
                      <summary>Instagram 연결 설정 방법</summary>
                      <ol>
                        <li>
                          <a
                            href="https://developers.facebook.com/apps/"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Meta 앱 대시보드
                          </a>
                          에서 회사 앱의
                          <strong> Instagram API with Instagram Login</strong>을
                          열고
                          <code>instagram_business_basic</code> 조회 권한을
                          설정하세요.
                        </li>
                        <li>
                          로그인 리디렉션 URI 목록에 이 주소를 추가하세요.
                          <label>
                            달력 리디렉션 주소
                            <input
                              readOnly
                              value={
                                window.location.origin +
                                '/api/auth/instagram/calendar/callback'
                              }
                              onFocus={(e) => e.currentTarget.select()}
                            />
                          </label>
                        </li>
                        <li>
                          <a
                            href="https://dash.cloudflare.com/"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Cloudflare
                          </a>
                          의 Workers &amp; Pages에서
                          <strong>
                            {' '}
                            jbgolf-connection → Settings → Variables and Secrets
                            → Production
                          </strong>
                          을 여세요. Instagram 앱 ID는{' '}
                          <code>INSTAGRAM_APP_ID</code> 변수로, Instagram 앱
                          비밀키는 <code>INSTAGRAM_APP_SECRET</code> Secret으로
                          저장하세요.
                        </li>
                        <li>
                          설정을 저장하고 달력을 새로고침한 뒤 각 계정의{' '}
                          <strong>연결</strong>을 눌러 해당 Instagram 계정으로
                          승인하세요.
                        </li>
                      </ol>
                    </details>
                  )}
                  {actionError && <Notice>{actionError}</Notice>}
                </div>
              </>
            )}
            {panel.type === 'day' && (
              <>
                <div className="cc-dialog-body cc-day-items">
                  {!current ? (
                    <p>{error || '콘텐츠를 불러오는 중입니다.'}</p>
                  ) : dailyEntries.length ? (
                    <EntryList
                      entries={dailyEntries}
                      showStatus
                      onEdit={readFeed ? undefined : (p) => editor(p.date, p)}
                    />
                  ) : (
                    <p>이 날짜에 표시할 게시물이나 일정이 없습니다.</p>
                  )}
                </div>
                {!readFeed && (
                  <div className="cc-dialog-foot">
                    <button
                      className="cc-primary"
                      type="button"
                      onClick={() => editor(panel.date)}
                    >
                      <Plus size={16} aria-hidden="true" />이 날짜에 일정 등록
                    </button>
                  </div>
                )}
              </>
            )}
            {panel.type === 'editor' &&
              draft &&
              (confirmDelete ? (
                <>
                  <div className="cc-dialog-body">
                    <p>
                      <strong>{panel.original?.title}</strong> 일정을
                      삭제할까요?
                    </p>
                    {actionError && <Notice>{actionError}</Notice>}
                  </div>
                  <div className="cc-dialog-foot">
                    <button
                      className="cc-outline"
                      disabled={busy}
                      type="button"
                      onClick={dismiss}
                    >
                      취소
                    </button>
                    <button
                      className="cc-primary"
                      disabled={busy}
                      type="button"
                      onClick={() => void write('delete')}
                    >
                      {busy ? '삭제 중…' : '삭제하기'}
                    </button>
                  </div>
                </>
              ) : (
                <form className="cc-form" onSubmit={submit}>
                  <fieldset
                    className="cc-dialog-body cc-fields"
                    disabled={busy || conflict}
                    aria-label="일정 정보"
                  >
                    <label className="cc-wide">
                      일정 제목
                      <input
                        value={draft.title}
                        autoFocus
                        maxLength={CALENDAR_LIMITS.title}
                        required
                        onChange={(e) => setField('title', e.target.value)}
                      />
                    </label>
                    <label className="cc-wide">
                      계정
                      <select
                        value={draft.account}
                        onChange={(e) =>
                          setField('account', e.target.value as Account)
                        }
                      >
                        {CALENDAR_ACCOUNTS.map((a) => (
                          <option key={a} value={a}>
                            @{a}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="cc-kind cc-wide">
                      <legend>콘텐츠 유형</legend>
                      {(['post', 'reel'] as const).map((kind) => (
                        <label key={kind}>
                          <input
                            type="radio"
                            name="cc-kind"
                            value={kind}
                            checked={draft.kind === kind}
                            onChange={() => setField('kind', kind)}
                          />
                          <span>
                            <EntryIcon kind={kind} />
                            {kindLabels[kind]}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      날짜
                      <input
                        required
                        type="date"
                        value={draft.date}
                        onChange={(e) => setField('date', e.target.value)}
                      />
                    </label>
                    <label>
                      시간 <small>(한국시간)</small>
                      <input
                        type="time"
                        value={draft.time ?? ''}
                        onChange={(e) =>
                          setField('time', e.target.value || null)
                        }
                      />
                    </label>
                    <label className="cc-wide">
                      메모
                      <textarea
                        rows={3}
                        maxLength={CALENDAR_LIMITS.note}
                        value={draft.note}
                        onChange={(e) => setField('note', e.target.value)}
                      />
                    </label>
                  </fieldset>
                  {actionError && (
                    <div className="cc-form-error">
                      <Notice>
                        {actionError}{' '}
                        {conflict && (
                          <button
                            className="cc-text"
                            type="button"
                            onClick={() => {
                              setPanel(null)
                              setReload((n) => n + 1)
                            }}
                          >
                            달력 새로고침
                          </button>
                        )}
                      </Notice>
                    </div>
                  )}
                  <div className="cc-dialog-foot">
                    {panel.original && (
                      <button
                        className="cc-delete"
                        type="button"
                        disabled={busy || conflict}
                        onClick={() => {
                          setActionError('')
                          setConfirmDelete(true)
                        }}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                        일정 삭제
                      </button>
                    )}
                    <button
                      className="cc-outline"
                      type="button"
                      disabled={busy}
                      onClick={dismiss}
                    >
                      취소
                    </button>
                    <button
                      className="cc-primary"
                      disabled={busy || conflict || !draft.title.trim()}
                    >
                      {busy ? '저장 중…' : '저장'}
                    </button>
                  </div>
                </form>
              ))}
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}
