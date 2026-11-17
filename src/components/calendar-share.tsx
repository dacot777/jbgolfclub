import { useEffect, useRef, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export default function CalendarShare({
  csrfToken,
  onUnauthorized,
}: {
  csrfToken: string
  onUnauthorized: () => void
}) {
  const [open, setOpen] = useState(false)
  const [expires, setExpires] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const locking = useRef(false)
  const endpoint = '/api/admin/calendar/share'
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setReady(false)
    setMessage('')
    async function load() {
      try {
        const res = await fetch(endpoint, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (res.status === 401) return onUnauthorized()
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!controller.signal.aborted) {
          setExpires(data.expiresAt)
          setReady(true)
        }
      } catch {
        if (!controller.signal.aborted)
          setMessage('열람 링크 상태를 불러오지 못했습니다.')
      }
    }
    void load()
    return () => controller.abort()
  }, [open, retry, onUnauthorized])
  async function change(method: 'POST' | 'DELETE') {
    if (locking.current) return
    locking.current = true
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(endpoint, {
        method,
        cache: 'no-store',
        headers: { 'X-CSRF-Token': csrfToken },
      })
      if (res.status === 401) return onUnauthorized()
      if (!res.ok) throw new Error()
      const data = await res.json()
      if (method === 'POST' && !/^[A-Za-z0-9_-]{43}$/.test(data.token))
        throw new Error()
      setExpires(data.expiresAt ?? null)
      setLink(
        method === 'POST'
          ? window.location.origin + '/#calendar-view/' + data.token
          : '',
      )
      setMessage(
        method === 'POST'
          ? '링크를 복사해서 대표님께 전달하세요.'
          : '열람 링크를 해제했습니다.',
      )
    } catch {
      setMessage(
        '링크 변경을 확인하지 못했습니다. 다시 열어 상태를 확인하세요.',
      )
    } finally {
      locking.current = false
      setBusy(false)
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setMessage('열람 링크를 복사했습니다.')
    } catch {
      setMessage('아래 주소를 선택해 복사하세요.')
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          setOpen(next)
          if (!next) setLink('')
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Link2 aria-hidden="true" />
          대표님 열람 링크
        </Button>
      </DialogTrigger>
      <DialogContent className="calendar-sharing">
        <DialogTitle>캘린더 열람 링크</DialogTitle>
        <DialogDescription>
          링크를 받은 사람은 세 계정의 발행 콘텐츠와 일정 제목·날짜를 볼 수
          있습니다. 일정 메모와 편집 기능은 관리자 전용입니다.
        </DialogDescription>
        {ready && expires && (
          <p>
            열람 기한{' '}
            <strong>
              {new Intl.DateTimeFormat('ko-KR', {
                timeZone: 'Asia/Seoul',
                dateStyle: 'medium',
              }).format(new Date(expires))}
            </strong>
          </p>
        )}
        {ready && !expires && <p>링크를 만들면 30일간 열람할 수 있습니다.</p>}
        {ready && expires && !link && (
          <p>새 링크를 만들면 이전 링크의 열람이 종료됩니다.</p>
        )}
        {link && (
          <label>
            열람 주소
            <input
              value={link}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        )}
        <div className="calendar-share-actions">
          {!ready && message && (
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>
              다시 확인
            </Button>
          )}
          {ready &&
            (link ? (
              <Button disabled={busy} onClick={() => void copy()}>
                링크 복사
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void change('POST')}>
                {expires ? '새 링크로 교체' : '열람 링크 만들기'}
              </Button>
            ))}
          {ready && expires && (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void change('DELETE')}
            >
              공유 해제
            </Button>
          )}
        </div>
        {message && <p role="status">{message}</p>}
      </DialogContent>
    </Dialog>
  )
}
