export const RECORD_LIMIT = 200
export const IMAGE_LIMIT = 8 * 1024 * 1024
export const BACKUP_LIMIT = 64 * 1024 * 1024
export const resultTypes = [
  '프로필 방문',
  '웹사이트 방문',
  '메시지 대화 시작',
  '랜딩 페이지 조회',
  '링크 클릭',
  '기타',
] as const
export type ResultType = (typeof resultTypes)[number]
export type InsightRecord = {
  id: string
  adName: string
  account: 'jbgolfacademy'
  capturedOn: string | null
  period: { start: string; end: string } | null
  spend: number | null
  views: string
  reach: number | null
  impressions: number | null
  resultType: ResultType
  resultCount: number | null
  notes: string
  screenshot: { name: string; dataUrl: string } | null
  createdAt: string
  updatedAt: string
}

export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}

export function exactViews(value: string): number | null {
  const normalized = value.trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(normalized)) return null
  const count = Number(normalized.replaceAll(',', ''))
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

function nonnegative(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  )
}

export function validateRecord(value: unknown): InsightRecord {
  if (!value || typeof value !== 'object')
    throw new Error('기록 형식을 확인해 주세요.')
  const r = value as InsightRecord
  const shortText = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max
  if (
    !shortText(r.id, 100) ||
    !r.id ||
    !shortText(r.adName, 100) ||
    !r.adName.trim() ||
    r.account !== 'jbgolfacademy' ||
    !shortText(r.views, 30) ||
    !shortText(r.notes, 4000) ||
    !nonnegative(r.spend) ||
    !nonnegative(r.reach) ||
    !nonnegative(r.impressions) ||
    !nonnegative(r.resultCount) ||
    !resultTypes.includes(r.resultType) ||
    !(r.capturedOn === null || validDate(r.capturedOn)) ||
    !shortText(r.createdAt, 40) ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    !shortText(r.updatedAt, 40) ||
    !Number.isFinite(Date.parse(r.updatedAt))
  ) {
    throw new Error(
      '기록의 이름·날짜·수치를 확인해 주세요. 수치는 0 이상의 정수로 입력합니다.',
    )
  }
  if (
    r.period !== null &&
    (!r.period ||
      !validDate(r.period.start) ||
      !validDate(r.period.end) ||
      r.period.start > r.period.end)
  ) {
    throw new Error('집계 시작일과 종료일을 확인해 주세요.')
  }
  if (
    r.screenshot !== null &&
    (!r.screenshot ||
      !shortText(r.screenshot.name, 200) ||
      typeof r.screenshot.dataUrl !== 'string' ||
      r.screenshot.dataUrl.length > Math.ceil((IMAGE_LIMIT * 4) / 3) + 100 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        r.screenshot.dataUrl,
      ))
  ) {
    throw new Error('첨부 이미지는 8MB 이하의 PNG·JPG·WebP만 가능합니다.')
  }
  // Whitelist fields: imported HTML, extra keys and credentials never enter storage.
  return {
    id: r.id,
    adName: r.adName.trim(),
    account: 'jbgolfacademy',
    capturedOn: r.capturedOn,
    period: r.period ? { start: r.period.start, end: r.period.end } : null,
    spend: r.spend,
    views: r.views,
    reach: r.reach,
    impressions: r.impressions,
    resultType: r.resultType,
    resultCount: r.resultCount,
    notes: r.notes,
    screenshot: r.screenshot
      ? { name: r.screenshot.name, dataUrl: r.screenshot.dataUrl }
      : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function periodLabel(r: InsightRecord) {
  return r.period ? `${r.period.start} — ${r.period.end}` : '기간 미확인'
}

// Cumulative snapshots from different periods must never be added together.
export function summarizePeriod(
  records: InsightRecord[],
  start: string,
  end: string,
) {
  const latest = new Map<string, InsightRecord>()
  for (const r of records) {
    if (r.period?.start !== start || r.period.end !== end) continue
    const previous = latest.get(r.adName)
    if (
      !previous ||
      previous.updatedAt < r.updatedAt ||
      (previous.updatedAt === r.updatedAt && previous.id < r.id)
    )
      latest.set(r.adName, r)
  }
  const selected = [...latest.values()]
  const completeSum = (values: (number | null)[]) =>
    values.length && values.every((v) => v !== null)
      ? values.reduce<number>((n, v) => n + (v ?? 0), 0)
      : null
  const results = resultTypes.flatMap((type) => {
    const matching = selected.filter((r) => r.resultType === type)
    if (!matching.length) return []
    return [{ type, count: completeSum(matching.map((r) => r.resultCount)) }]
  })
  return {
    records: selected,
    spend: completeSum(selected.map((r) => r.spend)),
    views: completeSum(selected.map((r) => exactViews(r.views))),
    results,
  }
}

export function recordReport(r: InsightRecord) {
  const number = (v: number | null, suffix: string) =>
    v === null ? '미기록' : `${v.toLocaleString('ko-KR')}${suffix}`
  return `[수동 기록 · @${r.account}]\n광고 구분 이름: ${r.adName}\n집계 기간: ${periodLabel(r)}\n캡처 기준일: ${r.capturedOn ?? '미확인'}\n지출: ${number(r.spend, '원')}\n조회수: ${r.views || '미기록'}\n${r.resultType}: ${number(r.resultCount, '회')}\n도달: ${number(r.reach, '명')}\n노출: ${number(r.impressions, '회')}\n${r.period ? '화면에서 확인한 집계 기간의 기록입니다.' : '집계 기간이 확인되지 않아 주간·월간 실적으로 사용할 수 없습니다.'}\n자동 수집 자료가 아니며, 반올림된 조회수는 화면 표시 그대로입니다.${r.notes ? `\n메모: ${r.notes}` : ''}`
}

export function createBackup(records: InsightRecord[]) {
  return JSON.stringify(
    {
      format: 'jbgolf-insights',
      version: 1,
      exportedAt: new Date().toISOString(),
      records,
    },
    null,
    2,
  )
}

export function readBackup(text: string): InsightRecord[] {
  const data = JSON.parse(text)
  if (
    !data ||
    data.format !== 'jbgolf-insights' ||
    data.version !== 1 ||
    !Array.isArray(data.records) ||
    data.records.length > RECORD_LIMIT
  ) {
    throw new Error(
      'JB Golf 인사이트 백업 파일(.json)을 선택해 주세요. 최대 200건을 가져올 수 있습니다.',
    )
  }
  const records = data.records.map(validateRecord)
  if (new Set(records.map((r: InsightRecord) => r.id)).size !== records.length)
    throw new Error('백업에 중복된 기록 ID가 있습니다.')
  return records
}

const DATABASE = 'jbgolf-private-insights'
const STORE = 'records'
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      resolve(db)
    }
    request.onerror = () =>
      reject(
        new Error(
          '브라우저 저장소를 열지 못했습니다. 일반 브라우저 창에서 다시 시도해 주세요.',
        ),
      )
    request.onblocked = () =>
      reject(new Error('다른 탭을 닫고 다시 시도해 주세요.'))
  })
}

export async function loadRecords(): Promise<InsightRecord[]> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).getAll()
      tx.oncomplete = () => {
        try {
          resolve(request.result.map(validateRecord))
        } catch {
          reject(
            new Error(
              '저장한 기록 형식을 읽지 못했습니다. 브라우저 데이터를 지우지 말고 담당자에게 알려 주세요.',
            ),
          )
        }
      }
      tx.onabort = () =>
        reject(
          new Error(
            '저장한 기록을 읽지 못했습니다. 새로고침 후 다시 시도해 주세요.',
          ),
        )
    })
  } finally {
    db.close()
  }
}

export async function storeRecords(
  records: InsightRecord[],
  removeId?: string,
): Promise<void> {
  const safe = records.map(validateRecord)
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      if (removeId) store.delete(removeId)
      for (const record of safe) store.put(record)
      tx.oncomplete = () => resolve()
      tx.onabort = () =>
        reject(
          new Error(
            '저장하지 못했습니다. 브라우저 저장 공간을 확인하고 백업을 내려받아 주세요.',
          ),
        )
    })
  } finally {
    db.close()
  }
}

export function downloadBackup(records: InsightRecord[]) {
  const url = URL.createObjectURL(
    new Blob([createBackup(records)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `JB골프_인사이트_백업_${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
