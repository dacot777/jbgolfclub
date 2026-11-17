import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ASSIGNEE_LABELS,
  BRANCH_LABELS,
  CHANNEL_LABELS,
  PRODUCT_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  type InquiryListRow,
} from '@/lib/inquiry-types'
import { useInquiryRefresh } from './use-inquiry-refresh'

const categories = {
  product: PRODUCT_LABELS,
  branch: BRANCH_LABELS,
  channel: CHANNEL_LABELS,
  source: SOURCE_LABELS,
  stage: STAGE_LABELS,
  assignee: ASSIGNEE_LABELS,
}

function isRow(value: unknown): value is InquiryListRow {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    (row.firstDate === null ||
      (typeof row.firstDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.firstDate))) &&
    Object.entries(categories).every(([key, options]) => {
      const entry = row[key]
      return (
        entry === null ||
        (typeof entry === 'string' && Object.hasOwn(options, entry))
      )
    })
  )
}

export function usePublicInquiryList(enabled: boolean) {
  const [rows, setRows] = useState<InquiryListRow[] | null>(null)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const pending = useRef(false)
  const refresh = useCallback(() => setRevision((n) => n + 1), [])
  useInquiryRefresh(enabled, () => {
    if (!pending.current) refresh()
  })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    async function load() {
      pending.current = true
      setError(false)
      try {
        const response = await fetch('/api/inquiries/list', {
          credentials: 'omit',
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(12000),
          ]),
        })
        if (!response.ok) throw new Error('read')
        const data = await response.json()
        if (!Array.isArray(data?.rows) || !data.rows.every(isRow))
          throw new Error('format')
        if (!controller.signal.aborted) setRows(data.rows)
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) pending.current = false
      }
    }
    void load()
    return () => {
      controller.abort()
      pending.current = false
    }
  }, [enabled, revision])
  return { rows, error, refresh }
}
