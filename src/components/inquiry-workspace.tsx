import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { AlertDialog } from 'radix-ui'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  ASSIGNEE_LABELS,
  BRANCH_LABELS,
  CHANNEL_LABELS,
  INQUIRY_LIMITS,
  PRODUCT_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  type Inquiry,
  type InquiryInput,
} from '@/lib/inquiry-types'
import type { MetaAdCard } from '@/lib/meta-ads-types'
import '@/inquiry-workspace.css'

type AdOption = Pick<MetaAdCard, 'id' | 'title'>
type Draft = Omit<InquiryInput, 'product' | 'channel'> & {
  product: InquiryInput['product'] | ''
  channel: InquiryInput['channel'] | ''
}
type Edit = {
  id: string
  version: number | null
  draft: Draft
  savedSummary?: string
}
const emptyDraft: Draft = {
  firstDate: null,
  branch: null,
  product: '',
  channel: '',
  source: 'unknown',
  adId: null,
  stage: 'received',
  assignee: 'unassigned',
  name: '',
  contact: '',
  note: '',
  nextAction: '',
}
const collectionPath = '/api/admin/inquiries'
const noStore = { credentials: 'same-origin', cache: 'no-store' } as const
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ))

function editItem(item: Inquiry): Edit {
  const { id, version, ...draft } = item
  const savedSummary = [
    item.name,
    PRODUCT_LABELS[item.product] + ' 문의',
    CHANNEL_LABELS[item.channel],
    item.branch && BRANCH_LABELS[item.branch],
    item.firstDate,
  ]
    .filter(Boolean)
    .join(' · ')
  return { id, version, draft, savedSummary }
}

function isItem(value: unknown): value is Inquiry {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    Number.isSafeInteger(row.version) &&
    (row.firstDate === null || typeof row.firstDate === 'string') &&
    (row.branch === null || Object.hasOwn(BRANCH_LABELS, String(row.branch))) &&
    (row.adId === null || typeof row.adId === 'string') &&
    ['name', 'contact', 'note', 'nextAction'].every(
      (key) => typeof row[key] === 'string',
    ) &&
    Object.hasOwn(PRODUCT_LABELS, String(row.product)) &&
    Object.hasOwn(CHANNEL_LABELS, String(row.channel)) &&
    Object.hasOwn(SOURCE_LABELS, String(row.source)) &&
    Object.hasOwn(STAGE_LABELS, String(row.stage)) &&
    Object.hasOwn(ASSIGNEE_LABELS, String(row.assignee))
  )
}

export default function InquiryWorkspace({
  csrfToken,
  onUnauthorized,
}: {
  csrfToken: string
  onUnauthorized: () => void
}) {
  const [items, setItems] = useState<Inquiry[] | null>(null)
  const [ads, setAds] = useState<AdOption[]>([])
  const [listError, setListError] = useState(false)
  const [adError, setAdError] = useState(false)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const [productFilter, setProductFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [adFilter, setAdFilter] = useState('')
  const returnFocus = useRef<HTMLElement | null>(null)
  const newButton = useRef<HTMLButtonElement>(null)
  const session = useRef<AbortController | null>(null)
  const listRequest = useRef(0)
  const writePending = useRef(false)
  const onUnauthorizedRef = useRef(onUnauthorized)
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized
  }, [onUnauthorized])

  const endSession = useCallback(() => {
    session.current?.abort()
    session.current = null
    setItems(null)
    setEdit(null)
    setNotice('')
    setProblem('')
    setConflict(false)
    setSaving(false)
    writePending.current = false
    onUnauthorizedRef.current()
  }, [])

  const load = useCallback(async () => {
    const current = session.current
    if (!current) return
    const request = ++listRequest.current
    try {
      const response = await fetch(collectionPath, {
        ...noStore,
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(12000)]),
      })
      if (current.signal.aborted) return
      if (response.status === 401 || response.status === 403) {
        endSession()
        return
      }
      if (!response.ok) throw new Error('read')
      const body = await response.json()
      if (!Array.isArray(body.items) || !body.items.every(isItem))
        throw new Error('format')
      if (current.signal.aborted || request !== listRequest.current) return
      const records: Inquiry[] = body.items
      setItems(records)
      setListError(false)
      return records
    } catch {
      if (!current.signal.aborted && request === listRequest.current)
        setListError(true)
    }
  }, [endSession])

  const loadAds = useCallback(async () => {
    const current = session.current
    if (!current) return
    try {
      const response = await fetch('/api/meta-ads', {
        ...noStore,
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(12000)]),
      })
      if (!response.ok) throw new Error('read')
      const body = await response.json()
      if (!Array.isArray(body.cards)) throw new Error('format')
      if (!current.signal.aborted) {
        setAds(
          body.cards.filter(
            (a: AdOption | null) =>
              a && typeof a.id === 'string' && typeof a.title === 'string',
          ),
        )
        setAdError(false)
      }
    } catch {
      if (!current.signal.aborted) setAdError(true)
    }
  }, [])

  useEffect(() => {
    const current = new AbortController()
    session.current = current
    setItems(null)
    setEdit(null)
    setListError(false)
    setProblem('')
    setNotice('')
    void load()
    void loadAds()
    const visible = () => {
      if (document.visibilityState === 'visible' && !writePending.current)
        void load()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      current.abort()
      document.removeEventListener('visibilitychange', visible)
    }
  }, [csrfToken, load, loadAds])

  const matches = (items ?? []).filter(
    (row) =>
      (!productFilter || row.product === productFilter) &&
      (!assigneeFilter || row.assignee === assigneeFilter) &&
      (!adFilter ||
        (adFilter === 'unlinked' ? !row.adId : row.adId === adFilter)),
  )
  const completed = matches.filter((row) => row.stage === 'completed').length
  const hasFilters = !!(productFilter || assigneeFilter || adFilter)
  const adNames = new Map(ads.map((ad) => [ad.id, ad.title]))
  const linkedOptions = new Map(adNames)
  for (const item of items ?? [])
    if (item.adId && !linkedOptions.has(item.adId))
      linkedOptions.set(item.adId, '기존 연결 광고')

  function openEditor(target: HTMLElement, record?: Inquiry) {
    returnFocus.current = target
    setNotice('')
    setProblem('')
    setConflict(false)
    setConfirmDelete(false)
    setEdit(
      record
        ? editItem(record)
        : { id: crypto.randomUUID(), version: null, draft: { ...emptyDraft } },
    )
  }
  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    setEdit((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              [field]: value,
              ...(field === 'source' && value !== 'instagram_ad'
                ? { adId: null }
                : {}),
            },
          }
        : null,
    )
    setProblem('')
  }

  async function submitEdit(action: 'save' | 'delete') {
    const current = session.current
    const deleting = action === 'delete'
    if (
      !current ||
      !edit ||
      (deleting
        ? !confirmDelete || edit.version === null
        : !edit.draft.product || !edit.draft.channel || confirmDelete) ||
      writePending.current ||
      conflict
    )
      return
    writePending.current = true
    setSaving(true)
    setProblem('')
    const creating = edit.version === null
    try {
      const response = await fetch(
        creating
          ? collectionPath
          : collectionPath + '/' + encodeURIComponent(edit.id),
        {
          ...noStore,
          method: deleting ? 'DELETE' : creating ? 'POST' : 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          signal: AbortSignal.any([current.signal, AbortSignal.timeout(15000)]),
          body: JSON.stringify(
            deleting
              ? { version: edit.version }
              : {
                  ...edit.draft,
                  ...(creating ? { id: edit.id } : { version: edit.version }),
                },
          ),
        },
      )
      if (current.signal.aborted) return
      if (response.status === 401 || response.status === 403) {
        endSession()
        return
      }
      if (response.status === 409) {
        setConfirmDelete(false)
        setConflict(true)
        return
      }
      if (!creating && response.status === 404) {
        removeFromList(edit.id, '이미 삭제된 문의입니다.')
        return
      }
      if (!response.ok) {
        setProblem(
          deleting
            ? '삭제하지 못했습니다. 다시 시도해 주세요.'
            : response.status === 400
              ? '입력 내용을 확인해 주세요. 연결할 광고가 목록에 있는지도 확인해 주세요.'
              : '저장하지 못했습니다. 입력한 내용으로 다시 시도해 주세요.',
        )
        return
      }
      const result = await response.json()
      if (current.signal.aborted) return
      if (deleting) {
        if (result.deleted !== true) throw new Error('format')
        removeFromList(edit.id, '문의 기록을 삭제했습니다.')
        return
      }
      const { item } = result
      if (!isItem(item) || item.id !== edit.id) throw new Error('format')
      if (current.signal.aborted) return
      ++listRequest.current
      setItems((records) => [
        item,
        ...(records ?? []).filter((row) => row.id !== item.id),
      ])
      setListError(false)
      setEdit(null)
      setNotice('문의 기록을 저장했습니다.')
    } catch {
      if (!current.signal.aborted)
        setProblem(
          deleting
            ? '삭제 결과를 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
            : '저장 결과를 확인할 수 없습니다. 연결을 확인한 뒤 다시 저장해 주세요.',
        )
    } finally {
      if (!current.signal.aborted) {
        writePending.current = false
        setSaving(false)
      }
    }
  }
  function removeFromList(id: string, message: string) {
    ++listRequest.current
    setItems((records) => records?.filter((row) => row.id !== id) ?? null)
    setListError(false)
    setConfirmDelete(false)
    setEdit(null)
    returnFocus.current = newButton.current
    setNotice(message)
  }
  async function reopenLatest() {
    if (!edit || saving) return
    setSaving(true)
    const latest = await load()
    if (!session.current) return
    const found = latest?.find((row) => row.id === edit.id)
    if (found) {
      setEdit(editItem(found))
      setConflict(false)
      setProblem('')
    } else if (latest && edit.version !== null) {
      removeFromList(edit.id, '이미 삭제된 문의입니다.')
    } else setProblem('최신 기록을 불러오지 못했습니다. 다시 시도해 주세요.')
    setSaving(false)
  }

  return (
    <section className="iq-workspace" aria-label="문의 관리">
      {items && (
        <dl
          className="iq-stats"
          aria-label={hasFilters ? '선택한 조건의 문의 현황' : '전체 문의 현황'}
        >
          <div>
            <dt>총 문의</dt>
            <dd>
              {matches.length.toLocaleString('ko-KR')}
              <small>건</small>
            </dd>
          </div>
          <div>
            <dt>신청·등록 완료</dt>
            <dd>
              {completed.toLocaleString('ko-KR')}
              <small>건</small>
            </dd>
          </div>
          <div>
            <dt>문의 → 등록률</dt>
            <dd>
              {matches.length
                ? new Intl.NumberFormat('ko-KR', {
                    maximumFractionDigits: 1,
                  }).format((completed * 100) / matches.length)
                : '—'}
              {matches.length > 0 && <small>%</small>}
            </dd>
            <span>
              문의 {matches.length}건 중 등록 {completed}건
            </span>
          </div>
        </dl>
      )}
      <section className="iq-panel" aria-labelledby="iq-list-title">
        <header className="iq-heading">
          <h2 id="iq-list-title">문의 목록</h2>
          {items && (
            <button
              ref={newButton}
              className="iq-primary"
              type="button"
              onClick={(e) => openEditor(e.currentTarget)}
            >
              <Plus size={17} aria-hidden="true" />새 문의
            </button>
          )}
        </header>
        {listError && (
          <div className="iq-feedback" role="alert">
            문의 목록을 불러오지 못했습니다.{' '}
            <button onClick={() => void load()}>다시 불러오기</button>
          </div>
        )}
        {!items && !listError && (
          <p className="iq-empty" role="status">
            문의 기록을 불러오는 중입니다.
          </p>
        )}
        {items && (
          <>
            <div className="iq-filters">
              <label>
                관심 상품
                <select
                  aria-label="상품 필터"
                  value={productFilter}
                  onChange={(e) => setProductFilter(e.target.value)}
                >
                  <option value="">전체 상품</option>
                  {options(PRODUCT_LABELS)}
                </select>
              </label>
              <label>
                담당자
                <select
                  aria-label="담당자 필터"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                >
                  <option value="">전체 담당자</option>
                  {options(ASSIGNEE_LABELS)}
                </select>
              </label>
              <label>
                연결된 광고
                <select
                  aria-label="광고 필터"
                  value={adFilter}
                  onChange={(e) => setAdFilter(e.target.value)}
                >
                  <option value="">전체 광고</option>
                  <option value="unlinked">연결 안 됨</option>
                  {[...linkedOptions].map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {notice && (
              <p className="iq-notice" role="status">
                <Check size={16} aria-hidden="true" />
                {notice}
              </p>
            )}
            {matches.length ? (
              <table className="iq-table">
                <caption className="sr-only">
                  관심 상품, 지점, 문의 채널, 유입 경로, 진행 상태와 담당자별
                  문의 기록
                </caption>
                <thead>
                  <tr>
                    {[
                      '문의',
                      '관심 상품',
                      '지점',
                      '문의 채널',
                      '유입 경로',
                      '진행 상태',
                      '담당자',
                      '수정',
                    ].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matches.map((row) => {
                    const title =
                      row.name || PRODUCT_LABELS[row.product] + ' 문의'
                    return (
                      <tr key={row.id}>
                        <th scope="row">
                          <strong>{title}</strong>
                          <small>{row.firstDate ?? '문의일 미확인'}</small>
                        </th>
                        <td>
                          <span className="iq-mobile-label">관심 상품</span>
                          {PRODUCT_LABELS[row.product]}
                        </td>
                        <td>
                          <span className="iq-mobile-label">지점</span>
                          {row.branch ? BRANCH_LABELS[row.branch] : '미지정'}
                        </td>
                        <td>
                          <span className="iq-mobile-label">문의 채널</span>
                          {CHANNEL_LABELS[row.channel]}
                        </td>
                        <td>
                          <span className="iq-mobile-label">유입 경로</span>
                          {SOURCE_LABELS[row.source]}
                          {row.adId && (
                            <small>
                              {adNames.get(row.adId) ?? '기존 연결 광고'}
                            </small>
                          )}
                        </td>
                        <td>
                          <span className="iq-mobile-label">진행 상태</span>
                          <span className={'iq-stage iq-stage-' + row.stage}>
                            {STAGE_LABELS[row.stage]}
                          </span>
                        </td>
                        <td>
                          <span className="iq-mobile-label">담당자</span>
                          <span className="iq-owner">
                            {ASSIGNEE_LABELS[row.assignee]}
                          </span>
                        </td>
                        <td>
                          <button
                            className="iq-edit"
                            type="button"
                            aria-label={title + ' 수정'}
                            onClick={(e) => openEditor(e.currentTarget, row)}
                          >
                            <Pencil size={15} aria-hidden="true" />
                            <span>수정</span>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div className="iq-empty">
                <ClipboardList size={26} aria-hidden="true" />
                <p>
                  {hasFilters
                    ? '선택한 조건에 맞는 문의가 없습니다.'
                    : '아직 등록한 문의가 없습니다.'}
                </p>
                {hasFilters && (
                  <button
                    onClick={() => {
                      setProductFilter('')
                      setAssigneeFilter('')
                      setAdFilter('')
                    }}
                  >
                    필터 초기화
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
      {edit && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !saving) setEdit(null)
          }}
        >
          <DialogContent
            className="iq-dialog"
            showCloseButton={false}
            aria-describedby={undefined}
            onPointerDownOutside={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              returnFocus.current?.focus()
            }}
          >
            <header className="iq-dialog-header">
              <DialogTitle>
                {edit.version === null ? '새 문의 기록' : '문의 수정'}
              </DialogTitle>
              <button
                aria-label="닫기"
                type="button"
                disabled={saving}
                className="iq-close"
                onClick={() => setEdit(null)}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <form
              className="iq-form"
              onSubmit={(event) => {
                event.preventDefault()
                void submitEdit('save')
              }}
              autoComplete="off"
            >
              <div className="iq-form-scroll">
                <fieldset className="iq-assignees" disabled={saving}>
                  <legend>인계 담당자</legend>
                  <div>
                    {Object.entries(ASSIGNEE_LABELS).map(([k, v]) => (
                      <label key={k}>
                        <input
                          type="radio"
                          name="iq-assignee"
                          value={k}
                          checked={edit.draft.assignee === k}
                          onChange={() =>
                            change('assignee', k as Draft['assignee'])
                          }
                        />
                        <span>
                          {edit.draft.assignee === k ? (
                            <Check aria-hidden="true" size={16} />
                          ) : (
                            <UserRound aria-hidden="true" size={16} />
                          )}{' '}
                          {v}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset
                  className="iq-fields"
                  disabled={saving}
                  aria-label="문의 상세 정보"
                >
                  <label>
                    관심 상품
                    <select
                      required
                      value={edit.draft.product}
                      onChange={(e) =>
                        change('product', e.target.value as Draft['product'])
                      }
                    >
                      <option value="">상품 선택</option>
                      {options(PRODUCT_LABELS)}
                    </select>
                  </label>
                  <label>
                    지점
                    <select
                      aria-label="지점"
                      value={edit.draft.branch ?? ''}
                      onChange={(e) =>
                        change(
                          'branch',
                          (e.target.value || null) as Draft['branch'],
                        )
                      }
                    >
                      <option value="">미지정</option>
                      {options(BRANCH_LABELS)}
                    </select>
                  </label>
                  <label>
                    문의 채널
                    <select
                      required
                      value={edit.draft.channel}
                      onChange={(e) =>
                        change('channel', e.target.value as Draft['channel'])
                      }
                    >
                      <option value="">채널 선택</option>
                      {options(CHANNEL_LABELS)}
                    </select>
                  </label>
                  <label>
                    유입 경로
                    <select
                      value={edit.draft.source}
                      onChange={(e) =>
                        change('source', e.target.value as Draft['source'])
                      }
                    >
                      {options(SOURCE_LABELS)}
                    </select>
                  </label>
                  <label>
                    진행 상태
                    <select
                      value={edit.draft.stage}
                      onChange={(e) =>
                        change('stage', e.target.value as Draft['stage'])
                      }
                    >
                      {options(STAGE_LABELS)}
                    </select>
                  </label>
                  {edit.draft.source === 'instagram_ad' && (
                    <div className="iq-wide">
                      <label>
                        확인된 광고
                        <select
                          value={edit.draft.adId ?? ''}
                          onChange={(e) =>
                            change('adId', e.target.value || null)
                          }
                        >
                          <option value="">광고 미확인</option>
                          {edit.draft.adId && !adNames.has(edit.draft.adId) && (
                            <option value={edit.draft.adId}>
                              기존 연결 광고
                            </option>
                          )}
                          {ads.map((ad) => (
                            <option key={ad.id} value={ad.id}>
                              {ad.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      {adError && (
                        <p className="iq-hint">
                          광고 목록을 불러오지 못했습니다.{' '}
                          <button type="button" onClick={() => void loadAds()}>
                            다시 불러오기
                          </button>
                        </p>
                      )}
                    </div>
                  )}
                  <label>
                    최초 문의일
                    <input
                      type="date"
                      value={edit.draft.firstDate ?? ''}
                      onChange={(e) =>
                        change('firstDate', e.target.value || null)
                      }
                    />
                  </label>
                  <label>
                    이름 또는 별칭
                    <input
                      value={edit.draft.name}
                      maxLength={INQUIRY_LIMITS.name}
                      onChange={(e) => change('name', e.target.value)}
                    />
                  </label>
                  <label className="iq-wide">
                    연락처
                    <input
                      value={edit.draft.contact}
                      maxLength={INQUIRY_LIMITS.contact}
                      onChange={(e) => change('contact', e.target.value)}
                    />
                  </label>
                  <label className="iq-wide">
                    상담 메모
                    <textarea
                      aria-label="상담 메모"
                      rows={3}
                      value={edit.draft.note}
                      maxLength={INQUIRY_LIMITS.note}
                      onChange={(e) => change('note', e.target.value)}
                    />
                  </label>
                  <label className="iq-wide">
                    다음 할 일
                    <input
                      value={edit.draft.nextAction}
                      maxLength={INQUIRY_LIMITS.nextAction}
                      onChange={(e) => change('nextAction', e.target.value)}
                    />
                  </label>
                </fieldset>
              </div>
              <footer className="iq-dialog-footer">
                {conflict && (
                  <div role="alert" className="iq-feedback">
                    이 문의의 최신 기록이 변경되었습니다. 최신 기록을 열면 현재
                    입력을 대체합니다.{' '}
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void reopenLatest()}
                    >
                      최신 기록 열기
                    </button>
                  </div>
                )}
                {problem && !confirmDelete && (
                  <p role="alert" className="iq-feedback">
                    {problem}
                  </p>
                )}
                <div>
                  {edit.version !== null && (
                    <AlertDialog.Root
                      open={confirmDelete}
                      onOpenChange={(open) => {
                        if (writePending.current) return
                        setProblem('')
                        setConfirmDelete(open)
                      }}
                    >
                      <AlertDialog.Trigger asChild>
                        <button
                          type="button"
                          className="iq-delete-trigger"
                          disabled={saving || conflict}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                          문의 삭제
                        </button>
                      </AlertDialog.Trigger>
                      <AlertDialog.Portal>
                        <AlertDialog.Overlay className="iq-delete-overlay" />
                        <AlertDialog.Content
                          className="iq-delete-confirm"
                          onEscapeKeyDown={(event) => {
                            if (writePending.current) event.preventDefault()
                          }}
                        >
                          <AlertDialog.Title>문의 삭제 확인</AlertDialog.Title>
                          <AlertDialog.Description>
                            <strong>{edit.savedSummary}</strong>
                            <br />이 문의를 삭제하면 복구할 수 없습니다.
                          </AlertDialog.Description>
                          {problem && (
                            <p role="alert" className="iq-feedback">
                              {problem}
                            </p>
                          )}
                          <div className="iq-delete-actions">
                            <AlertDialog.Cancel asChild>
                              <button
                                className="iq-secondary"
                                type="button"
                                disabled={saving}
                              >
                                취소
                              </button>
                            </AlertDialog.Cancel>
                            <button
                              className="iq-delete-final"
                              type="button"
                              disabled={saving}
                              onClick={() => void submitEdit('delete')}
                            >
                              {saving ? '삭제 중…' : '삭제하기'}
                            </button>
                          </div>
                        </AlertDialog.Content>
                      </AlertDialog.Portal>
                    </AlertDialog.Root>
                  )}
                  <button
                    className="iq-secondary"
                    type="button"
                    disabled={saving}
                    onClick={() => setEdit(null)}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="iq-primary"
                    disabled={saving || conflict}
                  >
                    {saving ? '처리 중…' : '저장'}
                  </button>
                </div>
              </footer>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
