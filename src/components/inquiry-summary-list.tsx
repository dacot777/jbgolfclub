import { useEffect, useState } from 'react'
import {
  BRANCH_LABELS,
  CHANNEL_LABELS,
  PRODUCT_LABELS,
  STAGE_LABELS,
  type InquirySummaryRow,
} from '@/lib/inquiry-types'
import '@/inquiry-workspace.css'

function isSummaryRow(value: unknown): value is InquirySummaryRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.product === 'string' &&
    Object.hasOwn(PRODUCT_LABELS, row.product) &&
    (row.branch === null ||
      (typeof row.branch === 'string' &&
        Object.hasOwn(BRANCH_LABELS, row.branch))) &&
    typeof row.channel === 'string' &&
    Object.hasOwn(CHANNEL_LABELS, row.channel) &&
    typeof row.stage === 'string' &&
    Object.hasOwn(STAGE_LABELS, row.stage) &&
    typeof row.count === 'number' &&
    Number.isSafeInteger(row.count) &&
    row.count > 0
  )
}

export default function InquirySummaryList() {
  const [rows, setRows] = useState<InquirySummaryRow[] | null>(null)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setError(false)
      try {
        const response = await fetch('/api/inquiries/summary', {
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(12000),
          ]),
        })
        if (!response.ok) throw new Error('read')
        const data = await response.json()
        if (!Array.isArray(data?.rows) || !data.rows.every(isSummaryRow))
          throw new Error('format')
        if (!controller.signal.aborted) setRows(data.rows)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    }
    void load()
    return () => controller.abort()
  }, [reload])
  return (
    <section className="iq-workspace" aria-labelledby="iq-summary-title">
      <div className="iq-panel">
        <header className="iq-heading">
          <div className="iq-list-title">
            <h2 id="iq-summary-title">문의 목록</h2>
            {rows && (
              <span
                className="iq-list-count"
                role="status"
                aria-label="전체 문의 현황"
              >
                총 문의{' '}
                {rows
                  .reduce((sum, row) => sum + row.count, 0)
                  .toLocaleString('ko-KR')}
                건
              </span>
            )}
          </div>
        </header>
        {error ? (
          <p className="iq-feedback" role="alert">
            문의 목록을 불러오지 못했습니다.{' '}
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              다시 불러오기
            </button>
          </p>
        ) : rows === null ? (
          <p className="iq-empty" role="status">
            문의 기록을 불러오는 중입니다.
          </p>
        ) : rows.length === 0 ? (
          <p className="iq-empty">등록된 문의가 없습니다.</p>
        ) : (
          <table className="iq-table">
            <caption className="sr-only">조건별 문의 건수</caption>
            <thead>
              <tr>
                {['관심 상품', '지점', '문의 채널', '진행 상태', '건수'].map(
                  (label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={[row.product, row.branch, row.channel, row.stage].join(
                    '/',
                  )}
                >
                  <th scope="row">{PRODUCT_LABELS[row.product]}</th>
                  <td>
                    <span className="iq-mobile-label">지점</span>
                    {row.branch ? BRANCH_LABELS[row.branch] : '미지정'}
                  </td>
                  <td>
                    <span className="iq-mobile-label">문의 채널</span>
                    {CHANNEL_LABELS[row.channel]}
                  </td>
                  <td>
                    <span className="iq-mobile-label">진행 상태</span>
                    <span className={'iq-stage iq-stage-' + row.stage}>
                      {STAGE_LABELS[row.stage]}
                    </span>
                  </td>
                  <td>{row.count.toLocaleString('ko-KR')}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
