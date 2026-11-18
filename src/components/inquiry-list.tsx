import { useId, useState, type ReactNode } from 'react'
import { Check, ClipboardList, SlidersHorizontal } from 'lucide-react'
import {
  ASSIGNEE_LABELS,
  BRANCH_LABELS,
  CHANNEL_LABELS,
  PRODUCT_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  type InquiryListRow,
} from '@/lib/inquiry-types'
import InquiryTable from './inquiry-table'
import '@/inquiry-workspace.css'

const columns = [
  '접수일',
  '관심 상품',
  '지점',
  '문의 채널',
  '유입 경로',
  '담당자',
  '진행 상태',
]

type ListProps<T extends InquiryListRow> = {
  rows: T[] | null
  error: boolean
  onRetry: () => void
  controls?: {
    newAction: ReactNode
    editAction: (row: T) => ReactNode
    rowId: (row: T) => string
    name?: (row: T) => string
    adId?: (row: T) => string | null
    ads?: Map<string, string>
    notice: string
  }
}

export default function InquiryList<T extends InquiryListRow>({
  rows,
  error,
  onRetry,
  controls,
}: ListProps<T>) {
  const filterId = useId()
  const [open, setOpen] = useState(false)
  const [product, setProduct] = useState('')
  const [assignee, setAssignee] = useState('')
  const [ad, setAd] = useState('')
  const filtered = !!(product || assignee || (controls?.adId && ad))
  const matches = rows?.filter(
    (row) =>
      (!product || row.product === product) &&
      (!assignee || row.assignee === assignee) &&
      (!controls?.adId ||
        !ad ||
        (ad === 'unlinked' ? !controls.adId(row) : controls.adId(row) === ad)),
  )
  return (
    <section className="iq-panel" aria-label="문의 목록">
      <header className="iq-heading">
        <div className="iq-list-title">
          <h2>문의 목록</h2>
          {rows && (
            <span
              className="iq-list-count"
              role="status"
              aria-label="전체 문의 현황"
            >
              총 문의 {rows.length.toLocaleString('ko-KR')}건
            </span>
          )}
        </div>
        {rows && (
          <div className="iq-list-actions">
            <button
              type="button"
              className="iq-secondary"
              aria-expanded={open}
              aria-controls={filterId}
              onClick={() => setOpen(!open)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              필터{filtered && ' 적용 중'}
            </button>
            {controls?.newAction}
          </div>
        )}
      </header>
      {error && (
        <p className="iq-feedback" role="alert">
          문의 목록을 불러오지 못했습니다.{' '}
          <button type="button" onClick={onRetry}>
            다시 불러오기
          </button>
        </p>
      )}
      {!rows && !error && (
        <p className="iq-empty" role="status">
          문의 기록을 불러오는 중입니다.
        </p>
      )}
      {rows && (
        <>
          <div id={filterId} className="iq-filters" hidden={!open}>
            <label>
              관심 상품
              <select
                aria-label="상품 필터"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">전체 상품</option>
                {Object.entries(PRODUCT_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              담당자
              <select
                aria-label="담당자 필터"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">전체 담당자</option>
                {Object.entries(ASSIGNEE_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {controls?.ads && (
              <label>
                연결된 광고
                <select
                  aria-label="광고 필터"
                  value={ad}
                  onChange={(e) => setAd(e.target.value)}
                >
                  <option value="">전체 광고</option>
                  <option value="unlinked">연결 안 됨</option>
                  {[...controls.ads].map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {filtered && (
            <p
              className="iq-filter-result"
              role="status"
              aria-label="선택한 조건의 문의 현황"
            >
              필터 결과 {(matches?.length ?? 0).toLocaleString('ko-KR')}건
            </p>
          )}
          {controls?.notice && (
            <p className="iq-notice" role="status">
              <Check size={16} aria-hidden="true" />
              {controls.notice}
            </p>
          )}
          {matches?.length ? (
            <InquiryTable
              caption="문의 목록 표"
              columns={controls?.name ? ['문의자', ...columns] : columns}
            >
              {matches.map((row, index) => (
                <tr key={controls ? controls.rowId(row) : index}>
                  {controls?.name ? (
                    <>
                      <th scope="row">
                        {controls.name(row).trim() || '이름 미입력'}
                      </th>
                      <td>{row.firstDate ?? '미확인'}</td>
                    </>
                  ) : (
                    <th scope="row">{row.firstDate ?? '미확인'}</th>
                  )}
                  <td>
                    {row.product ? PRODUCT_LABELS[row.product] : '미확인'}
                  </td>
                  <td>{row.branch ? BRANCH_LABELS[row.branch] : '미지정'}</td>
                  <td>
                    {row.channel ? CHANNEL_LABELS[row.channel] : '미확인'}
                  </td>
                  <td>{row.source ? SOURCE_LABELS[row.source] : '미확인'}</td>
                  <td className="iq-owner">
                    {row.assignee ? ASSIGNEE_LABELS[row.assignee] : '미확인'}
                  </td>
                  <td>
                    <div className="iq-status-cell">
                      <span
                        className={
                          'iq-stage iq-stage-' + (row.stage ?? 'unknown')
                        }
                      >
                        {row.stage ? STAGE_LABELS[row.stage] : '미확인'}
                      </span>
                      {controls?.editAction(row)}
                    </div>
                  </td>
                </tr>
              ))}
            </InquiryTable>
          ) : (
            <div className="iq-empty">
              <ClipboardList size={26} aria-hidden="true" />
              <p>
                {filtered
                  ? '선택한 조건에 맞는 문의가 없습니다.'
                  : '등록된 문의가 없습니다.'}
              </p>
              {filtered && (
                <button
                  onClick={() => {
                    setProduct('')
                    setAssignee('')
                    setAd('')
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
  )
}
