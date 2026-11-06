import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  Check,
  Copy,
  Download,
  FileImage,
  ImagePlus,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { number, won } from '@/lib/report'
import {
  BACKUP_LIMIT,
  IMAGE_LIMIT,
  RECORD_LIMIT,
  downloadBackup,
  exactViews,
  loadRecords,
  periodLabel,
  readBackup,
  recordReport,
  resultTypes,
  storeRecords,
  summarizePeriod,
  validateRecord,
  type InsightRecord,
  type ResultType,
} from '@/lib/manual-insights'
import '@/manual-insights.css'

type Draft = {
  adName: string
  capturedOn: string
  knownPeriod: boolean
  start: string
  end: string
  spend: string
  views: string
  resultType: ResultType
  resultCount: string
  reach: string
  impressions: string
  notes: string
  screenshot: InsightRecord['screenshot']
}
const emptyDraft = (): Draft => ({
  adName: '',
  capturedOn: '',
  knownPeriod: false,
  start: '',
  end: '',
  spend: '',
  views: '',
  resultType: '프로필 방문',
  resultCount: '',
  reach: '',
  impressions: '',
  notes: '',
  screenshot: null,
})
const asInput = (value: number | null) => (value === null ? '' : String(value))
const asNumber = (value: string) => (value.trim() === '' ? null : Number(value))
const displayNumber = (value: number | null, unit = '') =>
  value === null ? '미기록' : `${number(value)}${unit}`
function fromRecord(r: InsightRecord): Draft {
  return {
    adName: r.adName,
    capturedOn: r.capturedOn ?? '',
    knownPeriod: !!r.period,
    start: r.period?.start ?? '',
    end: r.period?.end ?? '',
    spend: asInput(r.spend),
    views: r.views,
    resultType: r.resultType,
    resultCount: asInput(r.resultCount),
    reach: asInput(r.reach),
    impressions: asInput(r.impressions),
    notes: r.notes,
    screenshot: r.screenshot,
  }
}

export default function ManualInsights() {
  const [records, setRecords] = useState<InsightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [storageReady, setStorageReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [editor, setEditor] = useState<InsightRecord | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const initialDraft = useRef('')
  const [formError, setFormError] = useState('')
  const formErrorRef = useRef<HTMLDivElement>(null)
  const [remove, setRemove] = useState<InsightRecord | null>(null)
  const [importing, setImporting] = useState<InsightRecord[] | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const importInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    loadRecords()
      .then((data) => {
        if (alive) {
          setRecords(data)
          setStorageReady(true)
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (formError) formErrorRef.current?.focus()
  }, [formError])

  function openEditor(r?: InsightRecord, followUp = false) {
    const next = r ? fromRecord(r) : emptyDraft()
    if (followUp) {
      next.capturedOn = ''
      next.spend = ''
      next.views = ''
      next.resultCount = ''
      next.reach = ''
      next.impressions = ''
      next.notes = ''
      next.screenshot = null
      next.knownPeriod = false
      next.start = ''
      next.end = ''
    }
    setDraft(next)
    initialDraft.current = JSON.stringify(next)
    setFormError('')
    setEditor(r && !followUp ? r : 'new')
  }
  function closeEditor() {
    if (busy || imageBusy) return
    if (
      JSON.stringify(draft) !== initialDraft.current &&
      !window.confirm(
        '아직 저장하지 않은 내용이 있습니다. 닫고 입력 내용을 버릴까요?',
      )
    )
      return
    setEditor(null)
  }
  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }
  async function readImage(file?: File) {
    if (!file) return
    setFormError('')
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > IMAGE_LIMIT
    ) {
      setFormError('8MB 이하의 PNG·JPG·WebP 이미지를 선택해 주세요.')
      return
    }
    setImageBusy(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () =>
          reject(
            new Error('이미지를 읽지 못했습니다. 파일을 다시 선택해 주세요.'),
          )
        reader.readAsDataURL(file)
      })
      const img = new Image()
      img.src = dataUrl
      await img.decode()
      patch('screenshot', { name: file.name.slice(0, 200), dataUrl })
    } catch {
      setFormError(
        '이미지를 열지 못했습니다. 정상적인 PNG·JPG·WebP 파일을 선택해 주세요.',
      )
    } finally {
      setImageBusy(false)
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setBusy(true)
    try {
      if (editor === 'new' && records.length >= RECORD_LIMIT)
        throw new Error(
          '최대 200건까지 보관합니다. 먼저 백업하고 불필요한 기록을 정리해 주세요.',
        )
      const now = new Date().toISOString()
      const r = validateRecord({
        id: editor && editor !== 'new' ? editor.id : crypto.randomUUID(),
        account: 'jbgolfacademy',
        adName: draft.adName,
        capturedOn: draft.capturedOn || null,
        period: draft.knownPeriod
          ? { start: draft.start, end: draft.end }
          : null,
        spend: asNumber(draft.spend),
        views: draft.views.trim(),
        resultType: draft.resultType,
        resultCount: asNumber(draft.resultCount),
        reach: asNumber(draft.reach),
        impressions: asNumber(draft.impressions),
        notes: draft.notes,
        screenshot: draft.screenshot,
        createdAt: editor && editor !== 'new' ? editor.createdAt : now,
        updatedAt: now,
      })
      await storeRecords([r])
      setRecords((all) => [...all.filter((item) => item.id !== r.id), r])
      setEditor(null)
      setStatus(
        '이 브라우저에 기록을 저장했습니다. 백업 파일도 내려받아 두세요.',
      )
    } catch (e) {
      setFormError(
        e instanceof Error
          ? e.message
          : '저장하지 못했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function prepareImport(file?: File) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      if (file.size > BACKUP_LIMIT)
        throw new Error('백업은 64MB 이하의 JSON 파일을 선택해 주세요.')
      const imported = readBackup(await file.text())
      if (!imported.length) throw new Error('백업에 가져올 기록이 없습니다.')
      if (
        new Set([...records, ...imported].map((r) => r.id)).size > RECORD_LIMIT
      )
        throw new Error(
          '합친 기록이 200건을 넘습니다. 기존 기록을 백업하고 정리해 주세요.',
        )
      setImporting(imported)
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? 'JSON 백업 파일을 읽지 못했습니다. JB Golf에서 내보낸 파일을 선택해 주세요.'
          : e instanceof Error
            ? e.message
            : '백업을 읽지 못했습니다.',
      )
    } finally {
      setBusy(false)
      if (importInput.current) importInput.current.value = ''
    }
  }
  async function confirmImport() {
    if (!importing) return
    setBusy(true)
    try {
      await storeRecords(importing)
      const ids = new Set(importing.map((r) => r.id))
      setRecords((all) => [...all.filter((r) => !ids.has(r.id)), ...importing])
      setStatus(
        `${importing.length}건을 가져왔습니다. 수치와 집계 기간을 확인해 주세요.`,
      )
      setImporting(null)
    } catch (e) {
      setError((e as Error).message)
      setImporting(null)
    } finally {
      setBusy(false)
    }
  }
  async function deleteRecord() {
    if (!remove) return
    setBusy(true)
    try {
      await storeRecords([], remove.id)
      setRecords((all) => all.filter((r) => r.id !== remove.id))
      setStatus('기록을 삭제했습니다.')
      setRemove(null)
    } catch (e) {
      setError((e as Error).message)
      setRemove(null)
    } finally {
      setBusy(false)
    }
  }
  async function copyRecord(r: InsightRecord) {
    try {
      await navigator.clipboard.writeText(recordReport(r))
      setStatus('수동 기록 보고 문장을 복사했습니다.')
    } catch {
      setError(
        '복사 권한이 없습니다. 기록의 수치를 직접 선택해 복사하거나 백업을 사용해 주세요.',
      )
    }
  }

  const periodKeys = [
    ...new Set(
      records
        .filter((r) => r.period)
        .map((r) => `${r.period!.start}|${r.period!.end}`),
    ),
  ]
    .sort()
    .reverse()
  const validFilter =
    filter === 'all' || filter === 'unknown' || periodKeys.includes(filter)
      ? filter
      : 'all'
  const visible = records
    .filter(
      (r) =>
        (validFilter === 'all' ||
          (validFilter === 'unknown'
            ? !r.period
            : `${r.period?.start}|${r.period?.end}` === validFilter)) &&
        `${r.adName} ${r.resultType} ${r.notes}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const [start, end] = validFilter.split('|')
  const summary = end ? summarizePeriod(records, start, end) : null
  const unknownCount = records.filter((r) => !r.period).length
  const replacementCount =
    importing?.filter((r) => records.some((old) => old.id === r.id)).length ?? 0

  return (
    <div className="manual-insights" id="records">
      <section className="page-heading">
        <div>
          <p className="eyebrow">INSIGHT ARCHIVE</p>
          <h1>
            인사이트 기록<span>.</span>
          </h1>
          <p className="page-description">
            @jbgolfacademy · 지난 광고 성과를 캡처와 함께 차곡차곡.
          </p>
        </div>
        <Button
          onClick={() => openEditor()}
          disabled={loading || !storageReady || busy}
        >
          <Plus aria-hidden="true" />
          캡처 기록 추가
        </Button>
      </section>

      <section className="archive-intro" aria-label="수동 기록 안내">
        <div className="archive-intro-icon">
          <Camera aria-hidden="true" />
        </div>
        <div>
          <strong>자동 연결을 기다리는 동안, 지난 성과부터.</strong>
          <p>
            캡처 첨부 → 수치 입력·확인 → 기록 저장. Facebook 연결 없이 사용할 수
            있습니다.
          </p>
          <small>
            수치는 직접 확인해 입력합니다. 캡처만 첨부해도 먼저 보관할 수
            있습니다.
          </small>
        </div>
        <span className="archive-mode">수동 기록</span>
      </section>

      <div className="archive-storage">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>
          <strong>이 브라우저에만 저장됩니다.</strong> 이미지와 수치는 서버로
          전송하지 않습니다. 브라우저 데이터 삭제 전에는 백업을 내려받으세요.
          다른 기기에서는 백업을 가져와 이어서 사용합니다.
        </p>
      </div>
      {error && (
        <div className="archive-error" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="오류 알림 닫기">
            닫기
          </button>
        </div>
      )}
      <div className="archive-status" role="status" aria-live="polite">
        {status && (
          <>
            <Check size={15} aria-hidden="true" />
            {status}
          </>
        )}
      </div>

      <div className="archive-toolbar">
        <div className="archive-filter">
          <label htmlFor="archive-period">집계 기간</label>
          <select
            id="archive-period"
            value={validFilter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">모든 기록</option>
            <option value="unknown">기간 미확인</option>
            {periodKeys.map((key) => (
              <option key={key} value={key}>
                {key.replace('|', ' — ')}
              </option>
            ))}
          </select>
        </div>
        <div className="archive-search">
          <label htmlFor="archive-search">기록 검색</label>
          <input
            id="archive-search"
            type="search"
            placeholder="광고 구분 이름·메모 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="archive-backup">
          <Button
            variant="outline"
            disabled={loading || !records.length || busy}
            onClick={() => {
              downloadBackup(records)
              setStatus('이미지와 수치를 포함한 백업 파일을 내보냈습니다.')
            }}
          >
            <Download aria-hidden="true" />
            백업 내보내기
          </Button>
          <Button
            variant="outline"
            disabled={loading || !storageReady || busy}
            onClick={() => importInput.current?.click()}
          >
            <Upload aria-hidden="true" />
            백업 가져오기
          </Button>
          <input
            type="file"
            accept=".json,application/json"
            aria-label="인사이트 백업 파일"
            ref={importInput}
            hidden
            onChange={(e) => void prepareImport(e.target.files?.[0])}
          />
        </div>
      </div>

      {summary ? (
        <section className="archive-summary" aria-label="선택 기간 요약">
          <div>
            <span>선택 기간에 기록한 광고</span>
            <strong>
              {summary.records.length}
              <small>개</small>
            </strong>
          </div>
          <div>
            <span>기록된 지출 합계</span>
            <strong>
              {summary.spend === null ? '미기록 포함' : won(summary.spend)}
            </strong>
          </div>
          <div>
            <span>정확한 조회수 합계</span>
            <strong>
              {summary.views === null
                ? '합계 산출 불가'
                : `${number(summary.views)}회`}
            </strong>
          </div>
          <p>
            시작일·종료일이 정확히 같은 기록만 요약합니다. 같은 광고 구분 이름은
            마지막 저장 기록 1건을 사용합니다. 반올림·누락 값은 추정하지 않으며,
            도달은 합산하지 않습니다. 검색은 아래 목록에만 적용됩니다.
          </p>
          <div className="archive-results">
            {summary.results.map((r) => (
              <span key={r.type}>
                {r.type} <b>{displayNumber(r.count, '회')}</b>
              </span>
            ))}
          </div>
        </section>
      ) : (
        <div className="archive-count">
          <strong>{records.length}건 보관</strong>
          <span>
            기간 미확인 {unknownCount}건 · 서로 다른 기간과 누적 캡처는 합산하지
            않습니다.
          </span>
        </div>
      )}

      {loading ? (
        <div className="archive-empty" role="status">
          저장한 기록을 불러오는 중입니다.
        </div>
      ) : !storageReady ? (
        <div className="archive-empty">
          <ShieldCheck aria-hidden="true" />
          <h2>브라우저 저장소를 사용할 수 없습니다</h2>
          <p>
            일반 브라우저 창에서 다시 열어 주세요. 기존 기록을 지우지 말고
            새로고침해 다시 시도하세요.
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            다시 시도
          </Button>
        </div>
      ) : !visible.length ? (
        <Card className="archive-empty">
          <FileImage aria-hidden="true" />
          <h2>
            {records.length
              ? '조건에 맞는 기록이 없습니다'
              : '첫 광고 캡처를 기록해 보세요'}
          </h2>
          <p>
            {records.length
              ? '기간 필터나 검색어를 바꿔 주세요.'
              : '인스타그램의 광고 인사이트를 캡처하고, 보이는 수치를 입력하세요. 집계 기간을 모르면 비워 두어도 됩니다.'}
          </p>
          {!records.length && (
            <Button onClick={() => openEditor()}>
              <Plus aria-hidden="true" />
              캡처 기록 추가
            </Button>
          )}
        </Card>
      ) : (
        <div className="archive-list">
          {visible.map((r) => (
            <Card key={r.id} className="archive-record" aria-label={r.adName}>
              <div className="archive-record-main">
                <button
                  className="archive-thumbnail"
                  onClick={() => openEditor(r)}
                  aria-label={`${r.adName} 캡처와 기록 보기`}
                >
                  {r.screenshot ? (
                    <img
                      src={r.screenshot.dataUrl}
                      alt={`${r.adName} 인사이트 캡처`}
                      loading="lazy"
                    />
                  ) : (
                    <>
                      <FileImage aria-hidden="true" />
                      <span>원본 미첨부</span>
                    </>
                  )}
                </button>
                <div className="archive-record-content">
                  <div className="archive-record-heading">
                    <h2>{r.adName}</h2>
                    <span
                      className={
                        r.period
                          ? 'archive-period-badge known'
                          : 'archive-period-badge'
                      }
                    >
                      {periodLabel(r)}
                    </span>
                  </div>
                  <p className="archive-record-meta">
                    수동 기록 · 캡처 기준일 {r.capturedOn ?? '미확인'}
                  </p>
                  <dl className="archive-metrics">
                    <div>
                      <dt>지출</dt>
                      <dd>{r.spend === null ? '미기록' : won(r.spend)}</dd>
                    </div>
                    <div>
                      <dt>조회수</dt>
                      <dd>
                        {r.views || '미기록'}
                        {r.views && exactViews(r.views) === null && (
                          <small>화면 표시값</small>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{r.resultType}</dt>
                      <dd>{displayNumber(r.resultCount, '회')}</dd>
                    </div>
                  </dl>
                  {r.notes && <p className="archive-record-notes">{r.notes}</p>}
                </div>
              </div>
              <div className="archive-record-actions">
                <span>
                  {r.period ? '확인된 기간의 기록' : '주간·월간 합계 제외'}
                </span>
                <Button variant="ghost" onClick={() => openEditor(r)}>
                  수정·캡처 보기
                </Button>
                <Button variant="ghost" onClick={() => openEditor(r, true)}>
                  <Plus aria-hidden="true" />
                  후속 캡처 기록
                </Button>
                <Button variant="ghost" onClick={() => void copyRecord(r)}>
                  <Copy aria-hidden="true" />
                  보고 복사
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`${r.adName} 기록 삭제`}
                  onClick={() => setRemove(r)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <footer className="archive-footer">
        수동 기록은 자동 수집 대시보드와 별도로 보관됩니다. 자동 갱신은 추후
        Meta 앱 설정과 광고 조회 권한을 연결한 뒤 진행합니다.
      </footer>

      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor()
        }}
      >
        <DialogContent className="archive-editor">
          <DialogHeader>
            <DialogTitle>
              {editor === 'new' ? '광고 캡처 기록 추가' : '광고 기록 수정'}
            </DialogTitle>
            <DialogDescription>
              캡처에 표시된 수치를 직접 확인해 입력하세요. 모르는 값은 비워
              둡니다.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void save(e)}>
            {formError && (
              <div
                className="archive-error"
                role="alert"
                tabIndex={-1}
                ref={formErrorRef}
              >
                {formError}
              </div>
            )}
            <div className="archive-editor-grid">
              <div className="archive-image-pane">
                <label className="archive-upload">
                  <ImagePlus size={20} aria-hidden="true" />
                  <strong>
                    {draft.screenshot ? '다른 캡처 선택' : '인사이트 캡처 첨부'}
                  </strong>
                  <span>PNG·JPG·WebP, 최대 8MB · 선택 사항</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="광고 인사이트 캡처"
                    disabled={busy || imageBusy}
                    onChange={(e) => {
                      void readImage(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                </label>
                {imageBusy && <p role="status">이미지를 읽는 중입니다.</p>}
                {draft.screenshot ? (
                  <>
                    <div className="archive-image-preview">
                      <img
                        src={draft.screenshot.dataUrl}
                        alt="첨부한 광고 인사이트 원본"
                      />
                    </div>
                    <p className="archive-image-name">
                      {draft.screenshot.name}
                    </p>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => patch('screenshot', null)}
                    >
                      첨부 제거
                    </Button>
                  </>
                ) : (
                  <div className="archive-image-placeholder">
                    <Camera aria-hidden="true" />
                    <p>캡처를 옆에 두고 수치를 확인하세요.</p>
                    <small>
                      파일을 첨부해도 자동으로 수치를 추출하거나 외부로 전송하지
                      않습니다.
                    </small>
                  </div>
                )}
              </div>
              <div className="archive-fields">
                <label>
                  광고 구분 이름 <span className="archive-required">필수</span>
                  <input
                    required
                    maxLength={100}
                    value={draft.adName}
                    onChange={(e) => patch('adName', e.target.value)}
                    placeholder="예: 주니어 모집 · 프로필 방문"
                    list="archive-ad-names"
                  />
                </label>
                <datalist id="archive-ad-names">
                  {[...new Set(records.map((r) => r.adName))].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <p className="archive-field-help">
                  기록용 이름입니다. 같은 광고의 후속 캡처는 같은 이름을
                  사용하세요.
                </p>
                <label>
                  캡처 기준일{' '}
                  <input
                    type="date"
                    value={draft.capturedOn}
                    onChange={(e) => patch('capturedOn', e.target.value)}
                  />
                </label>
                <fieldset className="archive-period-fields">
                  <legend>집계 기간</legend>
                  <label className="archive-check">
                    <input
                      type="checkbox"
                      checked={draft.knownPeriod}
                      onChange={(e) => patch('knownPeriod', e.target.checked)}
                    />
                    인사이트 화면에서 시작일·종료일을 확인했어요
                  </label>
                  {draft.knownPeriod ? (
                    <div className="archive-field-pair">
                      <label>
                        집계 시작일
                        <input
                          type="date"
                          required
                          value={draft.start}
                          max={draft.end || undefined}
                          onChange={(e) => patch('start', e.target.value)}
                        />
                      </label>
                      <label>
                        집계 종료일
                        <input
                          type="date"
                          required
                          value={draft.end}
                          min={draft.start || undefined}
                          onChange={(e) => patch('end', e.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <p>
                      기간 미확인으로 저장합니다. ‘광고 종료 예정일’은 집계
                      기간이 아닙니다.
                    </p>
                  )}
                </fieldset>
                <div className="archive-field-pair">
                  <label>
                    지출 (원)
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={draft.spend}
                      onChange={(e) => patch('spend', e.target.value)}
                      placeholder="화면에 보이는 지출"
                    />
                  </label>
                  <label>
                    조회수 (화면 표시 그대로)
                    <input
                      maxLength={30}
                      value={draft.views}
                      onChange={(e) => patch('views', e.target.value)}
                      placeholder="예: 5,625 또는 2만"
                    />
                  </label>
                </div>
                <div className="archive-field-pair">
                  <label>
                    결과 종류
                    <select
                      value={draft.resultType}
                      onChange={(e) =>
                        patch('resultType', e.target.value as ResultType)
                      }
                    >
                      {resultTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    결과 수 (회)
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={draft.resultCount}
                      onChange={(e) => patch('resultCount', e.target.value)}
                    />
                  </label>
                </div>
                <details className="archive-extra">
                  <summary>추가 수치 · 도달과 노출</summary>
                  <div className="archive-field-pair">
                    <label>
                      도달 (명)
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={draft.reach}
                        onChange={(e) => patch('reach', e.target.value)}
                      />
                    </label>
                    <label>
                      노출 (회)
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        value={draft.impressions}
                        onChange={(e) => patch('impressions', e.target.value)}
                      />
                    </label>
                  </div>
                  <p>
                    조회수와 노출은 서로 다른 수치입니다. 화면에 없으면 비워
                    두세요.
                  </p>
                </details>
                <label>
                  메모
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={draft.notes}
                    onChange={(e) => patch('notes', e.target.value)}
                    placeholder="타겟, 화면에 표시된 예산, 확인할 내용 등"
                  />
                </label>
              </div>
            </div>
            <div className="archive-editor-footer">
              <span>이미지·수치 모두 이 브라우저에 저장</span>
              <Button
                variant="outline"
                type="button"
                disabled={busy || imageBusy}
                onClick={closeEditor}
              >
                취소
              </Button>
              <Button type="submit" disabled={busy || imageBusy}>
                {busy ? '저장 중…' : '확인 후 저장'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이 기록을 삭제할까요?</DialogTitle>
            <DialogDescription>
              ‘{remove?.adName}’ 기록과 첨부 이미지가 이 브라우저에서
              삭제됩니다. 복구하려면 미리 백업해 두세요.
            </DialogDescription>
          </DialogHeader>
          <div className="archive-confirm-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(null)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void deleteRecord()}
            >
              {busy ? '삭제 중…' : '기록 삭제'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!importing}
        onOpenChange={(open) => {
          if (!open && !busy) setImporting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>백업 기록을 가져올까요?</DialogTitle>
            <DialogDescription>
              {importing?.length}건을 이 브라우저에 저장합니다. 같은 기록 ID{' '}
              {replacementCount}건은 백업 내용으로 덮어씁니다. 나머지 기존
              기록은 유지됩니다.
            </DialogDescription>
          </DialogHeader>
          <p className="archive-import-help">
            기존 기록을 먼저 백업하면 덮어쓰기 전 상태를 보관할 수 있습니다.
            다른 기간의 누적 기록은 별도 기록으로 유지하세요.
          </p>
          <div className="archive-confirm-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setImporting(null)}
            >
              취소
            </Button>
            <Button disabled={busy} onClick={() => void confirmImport()}>
              {busy ? '가져오는 중…' : '기록 가져오기'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
