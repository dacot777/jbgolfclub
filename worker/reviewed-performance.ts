import type { D1Database } from '@cloudflare/workers-types'
import {
  REVIEWED_METRIC_KEYS,
  type ReviewedAd,
  type ReviewedMetrics,
  type ReviewedPerformanceData,
  type ReviewedSnapshot,
} from '../src/lib/reviewed-performance-types'

type ObjectValue = Record<string, unknown>

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid reviewed record')
  return value as ObjectValue
}

function text(value: unknown, max: number, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    throw new Error('Invalid reviewed text')
  return value
}

function identifier(value: unknown): string {
  const result = text(value, 120)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result))
    throw new Error('Invalid reviewed identifier')
  return result
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid reviewed metric')
  return value
}

function nullableBoolean(value: unknown): boolean | null {
  if (value !== null && typeof value !== 'boolean')
    throw new Error('Invalid reviewed targeting toggle')
  return value
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error('Invalid reviewed targeting list')
  return value.map((item) => text(item, 100))
}

function date(value: unknown): string {
  const result = text(value, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    throw new Error('Invalid reviewed date')
  return result
}

function period(value: unknown): { start: string; end: string } {
  const raw = object(value)
  const result = { start: date(raw.start), end: date(raw.end) }
  if (result.start > result.end) throw new Error('Invalid reviewed period')
  return result
}

function reviewedAt(value: unknown): string {
  const result = text(value, 40)
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      result,
    ) ||
    !Number.isFinite(Date.parse(result))
  )
    throw new Error('Invalid review timestamp')
  date(result.slice(0, 10))
  return result
}

/** Only these fields may be returned to the published dashboard. */
export function validateReviewedAd(value: unknown): ReviewedAd {
  const raw = object(value)
  const postUrl = text(raw.postUrl, 200)
  if (
    !/^https:\/\/www\.instagram\.com\/(?:p|reel)\/[A-Za-z0-9_-]+\/$/.test(
      postUrl,
    )
  )
    throw new Error('Invalid Instagram post URL')
  let thumbnailUrl: string | null = null
  if (raw.thumbnailUrl !== undefined && raw.thumbnailUrl !== null) {
    thumbnailUrl = text(raw.thumbnailUrl, 200)
    if (
      !/^\/media\/posts\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(
        thumbnailUrl,
      )
    )
      throw new Error('Invalid reviewed thumbnail path')
  }
  if (!['active', 'paused', 'unknown'].includes(String(raw.status)))
    throw new Error('Invalid reviewed status')
  let schedule: ReviewedAd['schedule'] = null
  if (raw.schedule !== null) {
    const source = object(raw.schedule)
    schedule = {
      ...period(source),
      dailyBudget:
        source.dailyBudget === null ? null : integer(source.dailyBudget),
      totalBudget:
        source.totalBudget === undefined || source.totalBudget === null
          ? null
          : integer(source.totalBudget),
      durationDays: integer(source.durationDays),
    }
    if (!schedule.durationDays) throw new Error('Invalid reviewed duration')
  }
  let targeting: ReviewedAd['targeting'] = null
  if (raw.targeting !== undefined && raw.targeting !== null) {
    const source = object(raw.targeting)
    const ageMin = integer(source.ageMin)
    const ageMax = integer(source.ageMax)
    if (ageMin > ageMax || ageMax > 120)
      throw new Error('Invalid reviewed targeting ages')
    targeting = {
      locations: textList(source.locations),
      ageMin,
      ageMax,
      interests: textList(source.interests),
      locationOptimization: nullableBoolean(source.locationOptimization),
      advantageDetailedTargeting: nullableBoolean(
        source.advantageDetailedTargeting,
      ),
      advantageAudience: nullableBoolean(source.advantageAudience),
    }
  }
  return {
    id: identifier(raw.id),
    title: text(raw.title, 200),
    postUrl,
    thumbnailUrl,
    objective: text(raw.objective, 200),
    status: raw.status as ReviewedAd['status'],
    schedule,
    targeting,
  }
}

export function validateReviewedSnapshot(value: unknown): ReviewedSnapshot {
  const raw = object(value)
  if (raw.scope !== 'selected_period' && raw.scope !== 'lifetime')
    throw new Error('Invalid reviewed scope')
  const selectedPeriod = raw.period === null ? null : period(raw.period)
  if (raw.scope === 'selected_period' && !selectedPeriod)
    throw new Error('Selected periods need confirmed dates')
  const rawMetrics = object(raw.metrics)
  const metrics = {} as ReviewedMetrics
  for (const key of REVIEWED_METRIC_KEYS)
    metrics[key] =
      rawMetrics[key] === null ||
      (rawMetrics[key] === undefined &&
        (key === 'linkClickCost' || key === 'landingPageViews'))
        ? null
        : integer(rawMetrics[key])
  const reportedDays =
    raw.reportedDays === null ? null : integer(raw.reportedDays)
  if (reportedDays === 0) throw new Error('Invalid reported duration')
  return {
    id: identifier(raw.id),
    adId: identifier(raw.adId),
    period: selectedPeriod,
    scope: raw.scope,
    reportedDays,
    metrics,
    reviewedAt: reviewedAt(raw.reviewedAt),
    sourceLabel: text(raw.sourceLabel, 200),
    notes: text(raw.notes, 4000, true),
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/** Read-only reviewed data; this does not establish Meta advertising access. */
export async function reviewedPerformance(
  db: D1Database | undefined,
): Promise<Response> {
  if (!db) return json({ error: { code: 'performance_unavailable' } }, 503)
  try {
    const [adRows, snapshotRows] = await Promise.all([
      db
        .prepare('SELECT id, data FROM reviewed_ads ORDER BY id LIMIT 3')
        .all<{ id: string; data: string }>(),
      db
        .prepare(
          'SELECT id, ad_id, data FROM reviewed_snapshots ORDER BY id LIMIT 2001',
        )
        .all<{ id: string; ad_id: string; data: string }>(),
    ])
    if (adRows.results.length > 2 || snapshotRows.results.length > 2000)
      throw new Error('Reviewed data exceeds supported range')
    const ads = adRows.results.map((row) => {
      const ad = validateReviewedAd(JSON.parse(row.data))
      if (ad.id !== row.id) throw new Error('Reviewed ad ID mismatch')
      return ad
    })
    const adIds = new Set(ads.map((ad) => ad.id))
    const snapshots = snapshotRows.results.map((row) => {
      const snapshot = validateReviewedSnapshot(JSON.parse(row.data))
      if (
        snapshot.id !== row.id ||
        snapshot.adId !== row.ad_id ||
        !adIds.has(snapshot.adId)
      )
        throw new Error('Reviewed snapshot ID mismatch')
      return snapshot
    })
    let updatedAt: string | null = null
    for (const snapshot of snapshots)
      if (!updatedAt || Date.parse(snapshot.reviewedAt) > Date.parse(updatedAt))
        updatedAt = snapshot.reviewedAt
    const data: ReviewedPerformanceData = {
      version: 1,
      source: 'reviewed_screenshots',
      expectedAdCount: 2,
      updatedAt,
      ads,
      snapshots,
    }
    return json(data)
  } catch {
    // Avoid exposing SQL, stored raw data or internal error details.
    return json({ error: { code: 'performance_unavailable' } }, 503)
  }
}
