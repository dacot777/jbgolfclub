import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export default function InquiryTable({
  caption,
  columns,
  children,
}: {
  caption: string
  columns: string[]
  children: ReactNode
}) {
  const region = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const hintId = useId()
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const viewport = region.current
    if (!viewport || !table.current) return
    const measure = () =>
      setOverflows(viewport.scrollWidth > viewport.clientWidth + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(table.current)
    measure()
    return () => observer.disconnect()
  }, [])
  return (
    <>
      {overflows && (
        <p className="iq-scroll-hint" id={hintId}>
          표를 옆으로 밀어 모든 항목을 볼 수 있어요.
        </p>
      )}
      <div
        ref={region}
        className="iq-table-scroll"
        role="region"
        aria-label={caption}
        aria-describedby={overflows ? hintId : undefined}
        tabIndex={overflows ? 0 : undefined}
      >
        <table ref={table} className="iq-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </>
  )
}
