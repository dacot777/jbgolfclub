import type { Env } from './types'
import {
  discoverInstagramAds,
  syncMetaAdThumbnail,
  type MetaAdAsset,
} from './meta-ad-assets'
import type {
  MetaAdsDaily as Daily,
  MetaAdsMetrics,
  MetaAdsPeriod as Period,
  MetaAdsReport as Report,
  MetaCardPeriod,
} from '../src/lib/meta-ads-types'

type DateRange = { since: string; until: string }
type StoredPeriod = Period & { adPeriods?: MetaCardPeriod[] }
type StoredDay = Daily & { verifiedPostCode?: string }
type StoredReport = Omit<Report, 'daily'> & {
  daily: StoredDay[]
  adPeriods: MetaCardPeriod[]
}
type InsightLevel = 'account' | 'ad' | 'daily'

export function settings(env: Env) {
  const accountId = env.META_AD_ACCOUNT_ID?.replace(/^act_/, '')
  const token = env.META_ADS_ACCESS_TOKEN?.trim()
  const version = env.META_ADS_API_VERSION
  if (
    !accountId ||
    !/^\d+$/.test(accountId) ||
    !token ||
    !version ||
    !/^v\d+\.0$/.test(version)
  )
    return null
  return { accountId, token, version }
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}
function daysFrom(day: string, delta: number) {
  const date = new Date(day + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() + delta)
  return isoDate(date)
}
function reportingPeriods(now: Date, timeZone: string) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new Error('invalid_account_date')
  const weekday = new Date(today + 'T00:00:00Z').getUTCDay()
  const monday = daysFrom(today, -((weekday + 6) % 7))
  const month = today.slice(0, 7) + '-01'
  const previousMonthEnd = daysFrom(month, -1)
  const periods: (DateRange & { kind: Period['kind'] })[] = [
    { kind: 'week', since: monday, until: today },
    { kind: 'week', since: daysFrom(monday, -7), until: daysFrom(monday, -1) },
    { kind: 'month', since: month, until: today },
    {
      kind: 'month',
      since: previousMonthEnd.slice(0, 7) + '-01',
      until: previousMonthEnd,
    },
  ]
  return {
    today,
    periods,
    earliest: periods.reduce(
      (first, p) => (p.since < first ? p.since : first),
      today,
    ),
  }
}

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid_meta_response')
  return value as JsonObject
}
export function amount(value: unknown, integer = false) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error('invalid_metric')
  if (!/^\d+(?:\.\d+)?$/.test(String(value))) throw new Error('invalid_metric')
  const n = Number(value)
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)))
    throw new Error('invalid_metric')
  return n
}
export function metrics(row: JsonObject): MetaAdsMetrics {
  return {
    spend: amount(row.spend),
    impressions: amount(row.impressions, true),
    linkClicks: amount(row.inline_link_clicks, true),
  }
}

function postShortcode(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  return /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(
    value,
  )?.[1]
}

export function graph(config: NonNullable<ReturnType<typeof settings>>) {
  const account = new URL(
    `https://graph.facebook.com/${config.version}/act_${config.accountId}`,
  )
  let requests = 0
  async function get(url: URL) {
    // Leave headroom for D1 and the other scheduled Worker tasks on Workers Free.
    if (++requests > 24) throw new Error('meta_request_budget')
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + config.token },
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error('meta_request_failed')
    const result = object(await response.json())
    if ('error' in result) throw new Error('meta_request_failed')
    return result
  }
  async function insights(
    range: DateRange | 'maximum',
    level: InsightLevel,
    adIds?: string[],
  ) {
    const url = new URL(account.href + '/insights')
    url.search = new URLSearchParams({
      ...(range === 'maximum'
        ? { date_preset: 'maximum' }
        : {
            time_range: JSON.stringify({
              since: range.since,
              until: range.until,
            }),
          }),
      ...(adIds
        ? {
            filtering: JSON.stringify([
              { field: 'ad.id', operator: 'IN', value: adIds },
            ]),
          }
        : {}),
      level: level === 'account' ? 'account' : 'ad',
      breakdowns: 'publisher_platform',
      fields:
        'date_start,date_stop,spend,impressions,inline_link_clicks,reach' +
        (level === 'daily' ? ',ad_id,ad_name' : level === 'ad' ? ',ad_id' : ''),
      ...(level === 'daily' ? { time_increment: '1' } : {}),
      limit: '200',
    }).toString()
    const rows: JsonObject[] = []
    const afters = new Set<string>()
    while (true) {
      const result = await get(url)
      if (!Array.isArray(result.data)) throw new Error('invalid_insights_page')
      for (const value of result.data) {
        const row = object(value)
        if (
          typeof row.publisher_platform !== 'string' ||
          !row.publisher_platform
        )
          throw new Error('missing_platform')
        if (row.publisher_platform === 'instagram') rows.push(row)
      }
      if (result.paging == null) break
      const paging = object(result.paging)
      if (!paging.next) break
      const cursor = object(paging.cursors).after
      if (typeof cursor !== 'string' || !cursor || afters.has(cursor))
        throw new Error('invalid_cursor')
      afters.add(cursor)
      // Rebuild using the original account endpoint. Never send credentials to a returned URL.
      url.searchParams.set('after', cursor)
    }
    return rows
  }
  return {
    insights,
    canBackfillWeek: () => requests < 22,
    async postShortcodes(adIds: string[]) {
      const codes = new Map<string, string>()
      for (let start = 0; start < adIds.length; start += 50) {
        const ids = adIds.slice(start, start + 50)
        const url = new URL('./', account)
        url.searchParams.set('ids', ids.join(','))
        url.searchParams.set('fields', 'id,creative{instagram_permalink_url}')
        if (requests >= 16) break
        const ads = await get(url).catch((): JsonObject => ({}))
        for (const id of ids) {
          const ad = ads[id] as
            | { id?: string; creative?: { instagram_permalink_url?: string } }
            | undefined
          let code =
            ad?.id === id
              ? postShortcode(ad.creative?.instagram_permalink_url)
              : undefined
          if (!code && requests < 16) {
            try {
              const adUrl = new URL(id, url)
              adUrl.searchParams.set('fields', 'creative')
              const creativeId = object((await get(adUrl)).creative).id
              if (typeof creativeId === 'string' && /^\d+$/.test(creativeId)) {
                const creativeUrl = new URL(creativeId, url)
                creativeUrl.searchParams.set(
                  'fields',
                  'instagram_permalink_url',
                )
                code = postShortcode(
                  (await get(creativeUrl)).instagram_permalink_url,
                )
              }
            } catch {
              // Deleted/unavailable individual creatives do not invalidate other matched ads.
            }
          }
          if (code) codes.set(id, code)
        }
      }
      return codes
    },
    async accountInfo() {
      account.searchParams.set('fields', 'account_id,timezone_name,currency')
      const info = await get(account)
      account.search = ''
      if (
        info.account_id !== config.accountId ||
        typeof info.timezone_name !== 'string' ||
        !info.timezone_name ||
        typeof info.currency !== 'string' ||
        !/^[A-Z]{3}$/.test(info.currency)
      )
        throw new Error('invalid_ad_account')
      return { timeZone: info.timezone_name, currency: info.currency }
    },
  }
}

type RegistryRow = {
  adId: string
  publicKey: string
  reviewedId: string | null
  suppressed: number
  title: string
  postUrl: string | null
  status: MetaAdAsset['status']
  statusObservedAt: string | null
  startAt: string | null
  createdAt: string | null
  firstDeliveryDate: string | null
  lastActiveAt: string | null
  pausedSince: string | null
  thumbnailUpdatedAt: string | null
  thumbnailCreativeId: string | null
}
const registryQuery = `SELECT a.ad_id AS adId,a.public_key AS publicKey,a.reviewed_id AS reviewedId,
  a.suppressed,a.title,a.post_url AS postUrl,a.status,a.status_observed_at AS statusObservedAt,
  a.start_at AS startAt,a.created_at AS createdAt,a.first_delivery_date AS firstDeliveryDate,a.last_active_at AS lastActiveAt,a.paused_since AS pausedSince,
  t.updated_at AS thumbnailUpdatedAt,t.creative_id AS thumbnailCreativeId
  FROM meta_ad_registry a LEFT JOIN meta_ad_thumbnails t ON t.public_key=a.public_key
  WHERE a.account_id=? ORDER BY a.status_observed_at,a.public_key`

const publishedId = (row: RegistryRow) =>
  row.suppressed ? null : (row.reviewedId ?? row.publicKey)

type PauseEvent = {
  at: string
  source: 'observed' | 'meta'
  previousActiveAt: string | null
  lastDeliveryDate: string | null
}
const earlier = (left: string | null, right: string | null) =>
  left && right ? (left < right ? left : right) : (left ?? right)

async function buildRegistry(
  env: Env,
  accountId: string,
  daily: StoredDay[],
  previous: StoredDay[],
  api: ReturnType<typeof graph>,
  now: Date,
  timeZone: string,
) {
  const [saved, reviewed] = await env.DB.batch([
    env.DB.prepare(registryQuery).bind(accountId),
    env.DB.prepare(`SELECT id,json_extract(data,'$.postUrl') AS url,
      json_extract(data,'$.privateSourceMetadata.metaAds') AS verified FROM reviewed_ads`),
  ])
  const sources = (
    reviewed.results as { id: string; url: unknown; verified: unknown }[]
  ).map((card) => {
    const verified =
      typeof card.verified === 'string' ? JSON.parse(card.verified) : null
    return {
      id: String(card.id),
      code: postShortcode(card.url),
      ids: new Set<string>(
        verified?.accountId === accountId && Array.isArray(verified.adIds)
          ? verified.adIds
          : [],
      ),
    }
  })
  const registry = new Map(
    (saved.results as RegistryRow[]).map((row) => [row.adId, row]),
  )
  const names = new Map(daily.map((row) => [row.adId, row.adName]))
  const known = [
    ...new Set([
      ...registry.keys(),
      ...names.keys(),
      ...sources.flatMap((card) => [...card.ids]),
    ]),
  ]
  const discovered = await discoverInstagramAds(
    env,
    accountId,
    known,
    now,
  ).catch(() => [])
  const observed = new Map(discovered.map((asset) => [asset.adId, asset]))
  const candidates = new Set([
    ...known,
    ...discovered
      .filter(
        (asset) =>
          asset.instagram &&
          (asset.status === 'active' || asset.status === 'scheduled'),
      )
      .map((asset) => asset.adId),
  ])
  const fallbackIds = [...names.keys()].filter(
    (id) => !postShortcode(observed.get(id)?.postUrl),
  )
  const freshCodes = await api.postShortcodes(fallbackIds)
  const previousCodes = new Map(
    previous
      .filter((day) => day.verifiedPostCode)
      .map((day) => [day.adId, day.verifiedPostCode]),
  )
  const matched = new Map<string, string>()
  const events: {
    adId: string
    at: string
    source: PauseEvent['source']
    previousActiveAt: string | null
    localDate: string
  }[] = []
  const localDay = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const firstDelivery = new Map<string, string>()
  for (const day of daily) {
    if (
      [day.spend, day.impressions, day.linkClicks, day.reach].some(
        (value) => (value ?? 0) > 0,
      )
    )
      firstDelivery.set(
        day.adId,
        earlier(firstDelivery.get(day.adId) ?? null, day.date)!,
      )
  }
  const thumbnailJobs: { row: RegistryRow; asset: MetaAdAsset }[] = []
  for (const id of candidates) {
    if (!/^\d+$/.test(id)) continue
    const prior = registry.get(id)
    const asset = observed.get(id)
    // An explicit mapping also lets us read a paused ad with no recent delivery.
    if (!prior && !names.has(id) && !asset) continue
    const code =
      postShortcode(asset?.postUrl) ??
      freshCodes.get(id) ??
      postShortcode(prior?.postUrl) ??
      previousCodes.get(id)
    const exact = sources.filter(
      (card) => card.ids.has(id) || (code && card.code === code),
    )
    const row: RegistryRow = {
      adId: id,
      publicKey: prior?.publicKey ?? 'meta-' + crypto.randomUUID(),
      reviewedId: exact.length === 1 ? exact[0].id : null,
      suppressed: Number(exact.length > 1),
      title: asset?.title || names.get(id) || prior?.title || 'Instagram 광고',
      postUrl:
        asset?.postUrl && postShortcode(asset.postUrl) === code
          ? asset.postUrl
          : code
            ? postShortcode(prior?.postUrl) === code
              ? prior!.postUrl
              : 'https://www.instagram.com/p/' + code + '/'
            : null,
      status: asset ? asset.status : (prior?.status ?? 'unknown'),
      statusObservedAt: asset
        ? now.toISOString()
        : (prior?.statusObservedAt ?? null),
      startAt: asset?.startAt ?? prior?.startAt ?? null,
      createdAt: asset?.createdAt ?? prior?.createdAt ?? null,
      firstDeliveryDate: earlier(
        prior?.firstDeliveryDate ?? null,
        firstDelivery.get(id) ?? null,
      ),
      lastActiveAt:
        asset?.status === 'active'
          ? now.toISOString()
          : (prior?.lastActiveAt ?? null),
      pausedSince: prior?.pausedSince ?? null,
      thumbnailUpdatedAt: prior?.thumbnailUpdatedAt ?? null,
      thumbnailCreativeId: prior?.thumbnailCreativeId ?? null,
    }
    const precise = (asset?.pauseEvents ?? []).filter((event) =>
      Number.isFinite(Date.parse(event.at)),
    )
    for (const event of precise) {
      const at = new Date(event.at).toISOString()
      events.push({
        adId: id,
        at,
        source: 'meta',
        previousActiveAt:
          prior?.lastActiveAt && prior.lastActiveAt < at
            ? prior.lastActiveAt
            : null,
        localDate: localDay.format(new Date(at)),
      })
    }
    if (asset?.status === 'paused' && !row.pausedSince) {
      const at = now.toISOString()
      const knownPause = precise
        .map((event) => new Date(event.at).toISOString())
        .filter(
          (date) =>
            date <= at && (!prior?.lastActiveAt || date > prior.lastActiveAt),
        )
        .sort()
        .at(-1)
      row.pausedSince = knownPause ?? at
      if (!knownPause)
        events.push({
          adId: id,
          at,
          source: 'observed',
          previousActiveAt: prior?.lastActiveAt ?? null,
          localDate: localDay.format(now),
        })
    } else if (asset && asset.status !== 'paused' && asset.status !== 'unknown')
      row.pausedSince = null
    registry.set(id, row)
    const key = publishedId(row)
    if (key) matched.set(id, key)
    if (
      key &&
      asset?.thumbnailUrl &&
      (!row.thumbnailUpdatedAt ||
        (asset.creativeId && asset.creativeId !== row.thumbnailCreativeId))
    )
      thumbnailJobs.push({ row, asset })
  }
  for (const day of daily) {
    const key = matched.get(day.adId)
    if (key) day.reviewedAdId = key
    const code = postShortcode(registry.get(day.adId)?.postUrl)
    if (code) day.verifiedPostCode = code
  }
  return { registry, matched, thumbnailJobs, events }
}

type HistoryRow = {
  adId: string
  kind: Period['kind'] | 'day'
  since: string
  until: string
  payload: MetaAdsMetrics & { reach: number | null; adName?: string }
}

function periodHistoryRows(
  period: DateRange & { kind: Period['kind'] },
  rows: JsonObject[],
  registry: Map<string, RegistryRow>,
): HistoryRow[] {
  const result: HistoryRow[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row.ad_id !== 'string') throw new Error('invalid_ad_period')
    if (!registry.has(row.ad_id)) continue
    if (
      row.date_start !== period.since ||
      row.date_stop !== period.until ||
      seen.has(row.ad_id)
    )
      throw new Error('invalid_ad_period')
    seen.add(row.ad_id)
    result.push({
      adId: row.ad_id,
      kind: period.kind,
      since: period.since,
      until: period.until,
      payload: { ...metrics(row), reach: amount(row.reach, true) },
    })
  }
  return result
}

async function missingWeek(
  env: Env,
  accountId: string,
  daily: StoredDay[],
  previousMonday: string,
  today: string,
) {
  const recent = daily
    .filter(
      (row) =>
        row.date < previousMonday &&
        [row.spend, row.impressions, row.linkClicks, row.reach].some(
          (value) => (value ?? 0) > 0,
        ),
    )
    .map((row) => [row.adId, row.date])
  // Positive delivery identifies a missing week. Unique reach comes only from a separate exact-range Meta request.
  return env.DB.prepare(
    `WITH observed(ad_id,day) AS (
      SELECT ad_id,since FROM meta_ad_history WHERE account_id=?1 AND kind='day' AND since<?3
        AND (payload->>'$.impressions'>0 OR payload->>'$.spend'>0 OR payload->>'$.linkClicks'>0 OR payload->>'$.reach'>0)
      UNION ALL SELECT value->>'$[0]',value->>'$[1]' FROM json_each(?2)
    ), weeks AS (SELECT DISTINCT ad_id,date(day,'-6 days','weekday 1') AS monday FROM observed)
    SELECT w.monday AS since,date(w.monday,'+6 days') AS until FROM weeks w
    LEFT JOIN meta_ads_reports retry ON retry.account_id=?1 AND retry.kind='week-backfill' AND retry.since=w.monday
    WHERE NOT EXISTS (SELECT 1 FROM meta_ad_history h WHERE h.account_id=?1 AND h.ad_id=w.ad_id
      AND h.kind='week' AND h.since=w.monday AND h.until=date(w.monday,'+6 days'))
      AND (retry.payload IS NULL OR retry.payload->>'$.attemptDay'<?4)
    ORDER BY COALESCE(retry.payload->>'$.attemptDay',''),w.monday LIMIT 1`,
  )
    .bind(accountId, JSON.stringify(recent), previousMonday, today)
    .first<DateRange>()
}

function cardPeriods(
  period: Period,
  rows: JsonObject[],
  expected: Map<string, Set<string>>,
  matches: Map<string, string>,
): MetaCardPeriod[] {
  const metricsById = new Map<
    string,
    MetaAdsMetrics & { reach: number | null }
  >()
  for (const row of rows) {
    if (typeof row.ad_id !== 'string') throw new Error('invalid_ad_period')
    const card = matches.get(row.ad_id)
    if (!card) continue
    if (
      metricsById.has(row.ad_id) ||
      row.date_start !== period.since ||
      row.date_stop !== period.until
    )
      throw new Error('invalid_ad_period')
    const ids = expected.get(card) ?? new Set<string>()
    ids.add(row.ad_id)
    expected.set(card, ids)
    metricsById.set(row.ad_id, {
      ...metrics(row),
      reach: amount(row.reach, true),
    })
  }
  const result: MetaCardPeriod[] = []
  for (const [reviewedAdId, ids] of expected) {
    const values = [...ids].map((id) => metricsById.get(id))
    if (values.every((row) => !row)) continue
    const sum = (key: keyof MetaAdsMetrics) => {
      let total = 0
      for (const row of values) {
        if (row?.[key] == null) return null
        total += row[key]
      }
      return total
    }
    result.push({
      kind: period.kind,
      since: period.since,
      until: period.until,
      reviewedAdId,
      spend: sum('spend'),
      impressions: sum('impressions'),
      linkClicks: sum('linkClicks'),
      reach: values.length === 1 ? (values[0]?.reach ?? null) : null,
    })
  }
  return result
}

export async function collectMetaAds(
  env: Env,
  now = new Date(),
): Promise<void> {
  const config = settings(env)
  if (!config) return
  const run = crypto.randomUUID()
  const leaseStart = Date.now()
  const lease = await env.DB.prepare(
    `
    INSERT INTO meta_ads_sync (account_id, active_run, lease_until) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET active_run=excluded.active_run, lease_until=excluded.lease_until
    WHERE meta_ads_sync.lease_until <= ?`,
  )
    .bind(config.accountId, run, leaseStart + 10 * 60_000, leaseStart)
    .run()
  if (!lease.meta.changes) return
  try {
    const api = graph(config)
    const { currency, timeZone } = await api.accountInfo()
    const { today, periods, earliest } = reportingPeriods(now, timeZone)
    const savedPeriods: StoredPeriod[] = []
    for (const period of periods) {
      const rows = await api.insights(period, 'account')
      if (
        rows.length > 1 ||
        rows.some(
          (r) => r.date_start !== period.since || r.date_stop !== period.until,
        )
      )
        throw new Error('invalid_report_range')
      const row = rows[0] ?? {}
      savedPeriods.push({
        ...period,
        ...metrics(row),
        reach: amount(row.reach, true),
      })
    }
    const byDay = new Map<string, StoredDay[]>()
    const seen = new Set<string>()
    for (const row of await api.insights(
      { since: earliest, until: today },
      'daily',
    )) {
      const day = row.date_start
      if (
        typeof day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        day !== row.date_stop ||
        day < earliest ||
        day > today ||
        isoDate(new Date(day + 'T00:00:00Z')) !== day ||
        typeof row.ad_id !== 'string' ||
        !/^\d+$/.test(row.ad_id) ||
        typeof row.ad_name !== 'string'
      )
        throw new Error('invalid_ad_row')
      const key = day + '/' + row.ad_id
      if (seen.has(key)) throw new Error('duplicate_ad_row')
      seen.add(key)
      const group = byDay.get(day) ?? []
      group.push({
        date: day,
        adId: row.ad_id,
        adName: row.ad_name,
        reach: amount(row.reach, true),
        ...metrics(row),
      })
      byDay.set(day, group)
    }
    const daily = [...byDay.values()].flat()
    const previous = await readSnapshot(env)
    const { registry, matched, thumbnailJobs, events } = await buildRegistry(
      env,
      config.accountId,
      daily,
      previous.daily,
      api,
      now,
      timeZone,
    )
    const history: HistoryRow[] = daily.map((row) => ({
      adId: row.adId,
      kind: 'day',
      since: row.date,
      until: row.date,
      payload: {
        adName: row.adName,
        spend: row.spend,
        impressions: row.impressions,
        linkClicks: row.linkClicks,
        reach: row.reach ?? null,
      },
    }))
    for (const period of savedPeriods) {
      const expected = new Map<string, Set<string>>()
      for (const row of daily) {
        if (
          !row.reviewedAdId ||
          row.date < period.since ||
          row.date > period.until
        )
          continue
        const ids = expected.get(row.reviewedAdId) ?? new Set<string>()
        ids.add(row.adId)
        expected.set(row.reviewedAdId, ids)
      }
      if (!expected.size) continue
      try {
        const rows = await api.insights(period, 'ad')
        period.adPeriods = cardPeriods(period, rows, expected, matched)
        history.push(...periodHistoryRows(period, rows, registry))
      } catch (error) {
        // Preserve the last complete publication if the latest attempt would remove a card's period.
        if (
          previous.adPeriods.some(
            (row) =>
              row.kind === period.kind &&
              row.since === period.since &&
              expected.has(row.reviewedAdId),
          )
        )
          throw error
      }
    }
    const reports: {
      kind: string
      since: string
      payload: StoredPeriod | StoredDay[] | { attemptDay: string }
    }[] = savedPeriods.map((period) => ({
      kind: period.kind,
      since: period.since,
      payload: period,
    }))
    if (api.canBackfillWeek()) {
      const previousMonday = periods.find(
        (period) => period.kind === 'week' && period.until < today,
      )!.since
      const gap = await missingWeek(
        env,
        config.accountId,
        daily,
        previousMonday,
        today,
      )
      if (gap) {
        try {
          const rows = await api.insights(gap, 'ad')
          history.push(
            ...periodHistoryRows({ ...gap, kind: 'week' }, rows, registry),
          )
        } catch {
          // Keep current and previously published observations; another missing week can proceed on the next run.
        }
        reports.push({
          kind: 'week-backfill',
          since: gap.since,
          payload: { attemptDay: today },
        })
      }
    }
    // Include empty days so reruns also replace rows Meta has removed or re-attributed.
    for (let since = earliest; since <= today; since = daysFrom(since, 1))
      reports.push({ kind: 'day', since, payload: byDay.get(since) ?? [] })
    const serialized = JSON.stringify(reports)
    const serializedHistory = JSON.stringify(history)
    const serializedRegistry = JSON.stringify([...registry.values()])
    if (
      [serialized, serializedHistory, serializedRegistry].some(
        (value) => new TextEncoder().encode(value).byteLength > 750_000,
      )
    )
      throw new Error('report_too_large')
    // D1 executes a batch transactionally. A run that loses its lease cannot overwrite a later run.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO meta_ad_registry(account_id,ad_id,public_key,reviewed_id,suppressed,title,post_url,status,status_observed_at,start_at,created_at,first_delivery_date,last_active_at,paused_since)
        SELECT ?,j.value->>'$.adId',j.value->>'$.publicKey',j.value->>'$.reviewedId',j.value->>'$.suppressed',
          j.value->>'$.title',j.value->>'$.postUrl',j.value->>'$.status',j.value->>'$.statusObservedAt',
          j.value->>'$.startAt',j.value->>'$.createdAt',j.value->>'$.firstDeliveryDate',j.value->>'$.lastActiveAt',j.value->>'$.pausedSince'
        FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM meta_ads_sync WHERE account_id=? AND active_run=?)
        ON CONFLICT(account_id,ad_id) DO UPDATE SET reviewed_id=excluded.reviewed_id,suppressed=excluded.suppressed,
          title=excluded.title,post_url=excluded.post_url,status=excluded.status,status_observed_at=excluded.status_observed_at,
          start_at=excluded.start_at,created_at=excluded.created_at,first_delivery_date=excluded.first_delivery_date,last_active_at=excluded.last_active_at,paused_since=excluded.paused_since
        WHERE (reviewed_id,suppressed,title,post_url,status,status_observed_at,start_at,created_at,first_delivery_date,last_active_at,paused_since)
          IS NOT (excluded.reviewed_id,excluded.suppressed,excluded.title,excluded.post_url,excluded.status,excluded.status_observed_at,
            excluded.start_at,excluded.created_at,excluded.first_delivery_date,excluded.last_active_at,excluded.paused_since)`,
      ).bind(config.accountId, serializedRegistry, config.accountId, run),
      env.DB.prepare(
        `INSERT OR IGNORE INTO meta_ad_history_revisions(account_id,ad_id,kind,since,until,replaced_at,payload)
        SELECT h.account_id,h.ad_id,h.kind,h.since,h.until,?,h.payload
        FROM json_each(?) j JOIN meta_ad_history h ON h.account_id=? AND h.ad_id=j.value->>'$.adId'
          AND h.kind=j.value->>'$.kind' AND h.since=j.value->>'$.since' AND h.until=j.value->>'$.until'
        WHERE h.payload IS NOT j.value->>'$.payload' AND EXISTS
          (SELECT 1 FROM meta_ads_sync WHERE account_id=? AND active_run=?)`,
      ).bind(
        now.toISOString(),
        serializedHistory,
        config.accountId,
        config.accountId,
        run,
      ),
      env.DB.prepare(
        `INSERT INTO meta_ad_history(account_id,ad_id,kind,since,until,payload)
        SELECT ?,j.value->>'$.adId',j.value->>'$.kind',j.value->>'$.since',j.value->>'$.until',j.value->>'$.payload'
        FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM meta_ads_sync WHERE account_id=? AND active_run=?)
        ON CONFLICT(account_id,ad_id,kind,since,until) DO UPDATE SET payload=excluded.payload
        WHERE payload IS NOT excluded.payload`,
      ).bind(config.accountId, serializedHistory, config.accountId, run),
      env.DB.prepare(
        `INSERT OR IGNORE INTO meta_ad_pause_events(account_id,ad_id,at,source,previous_active_at,last_delivery_date)
        SELECT ?,j.value->>'$.adId',j.value->>'$.at',j.value->>'$.source',j.value->>'$.previousActiveAt',
          (SELECT MAX(h.since) FROM meta_ad_history h WHERE h.account_id=? AND h.ad_id=j.value->>'$.adId' AND h.kind='day'
            AND h.since <= j.value->>'$.localDate' AND (h.payload->>'$.impressions'>0 OR h.payload->>'$.spend'>0 OR h.payload->>'$.linkClicks'>0 OR h.payload->>'$.reach'>0))
        FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM meta_ads_sync WHERE account_id=? AND active_run=?)`,
      ).bind(
        config.accountId,
        config.accountId,
        JSON.stringify(events),
        config.accountId,
        run,
      ),
      env.DB.prepare(
        `INSERT INTO meta_ads_reports (account_id, kind, since, run, payload)
        SELECT ?, json_extract(value,'$.kind'), json_extract(value,'$.since'), ?, json_extract(value,'$.payload')
        FROM json_each(?) WHERE EXISTS (SELECT 1 FROM meta_ads_sync WHERE account_id=? AND active_run=?)
        ON CONFLICT (account_id,kind,since) DO UPDATE SET run=excluded.run, payload=excluded.payload`,
      ).bind(config.accountId, run, serialized, config.accountId, run),
      env.DB.prepare(
        `UPDATE meta_ads_sync SET published_run=?, synced_at=?, currency=?, time_zone=?,
        status='ready', active_run=NULL, lease_until=0 WHERE account_id=? AND active_run=?`,
      ).bind(run, now.toISOString(), currency, timeZone, config.accountId, run),
    ])
    // Thumbnail failures must not erase the saved report or an earlier image.
    // Rotate unresolved downloads so one unavailable creative cannot starve newer cards.
    thumbnailJobs.sort((a, b) => a.row.publicKey.localeCompare(b.row.publicKey))
    const offset = thumbnailJobs.length
      ? Math.floor(now.getTime() / 3_600_000) % thumbnailJobs.length
      : 0
    for (const { row, asset } of [
      ...thumbnailJobs.slice(offset),
      ...thumbnailJobs.slice(0, offset),
    ].slice(0, 3))
      await syncMetaAdThumbnail(
        env,
        row.publicKey,
        asset.thumbnailUrl!,
        asset.creativeId,
      ).catch(() => false)
  } catch {
    await env.DB.prepare(
      `UPDATE meta_ads_sync SET status='error', active_run=NULL, lease_until=0
      WHERE account_id=? AND active_run=?`,
    )
      .bind(config.accountId, run)
      .run()
  }
}

async function readSnapshot(env: Env): Promise<StoredReport> {
  const config = settings(env)
  const empty: StoredReport = {
    status: config ? 'pending' : 'unconfigured',
    lastSyncedAt: null,
    timeZone: null,
    currency: null,
    periods: [],
    daily: [],
    adPeriods: [],
  }
  if (!config) return empty
  const [stateResult, rowsResult] = await env.DB.batch<
    Record<string, string | null>
  >([
    env.DB.prepare(
      'SELECT status, synced_at, currency, time_zone FROM meta_ads_sync WHERE account_id=?',
    ).bind(config.accountId),
    env.DB.prepare(
      `SELECT r.kind, r.payload FROM meta_ads_reports r JOIN meta_ads_sync s
      ON r.account_id=s.account_id AND r.run=s.published_run WHERE s.account_id=?
      AND r.kind IN ('day','week','month') ORDER BY r.since DESC`,
    ).bind(config.accountId),
  ])
  const state = stateResult.results[0]
  if (!state) return empty
  const report = {
    ...empty,
    status: state.status as Report['status'],
    lastSyncedAt: state.synced_at as string | null,
    currency: state.currency as string | null,
    timeZone: state.time_zone as string | null,
  }
  for (const row of rowsResult.results) {
    const parsed = JSON.parse(row.payload as string)
    if (row.kind === 'day') report.daily.push(...parsed)
    else {
      const { adPeriods, ...period } = parsed as StoredPeriod
      report.periods.push(period)
      if (Array.isArray(adPeriods)) report.adPeriods.push(...adPeriods)
    }
  }
  return report
}

export async function readMetaAds(env: Env): Promise<Report> {
  const { adPeriods: _, daily, ...report } = await readSnapshot(env)
  return {
    ...report,
    daily: daily.map(({ verifiedPostCode: _code, ...row }) => row),
  }
}

async function readCardHistory(env: Env) {
  type Card = {
    id: string
    title: string
    postUrl: string | null
    status: MetaAdAsset['status']
    statusObservedAt: string | null
    thumbnailUrl: string | null
    startAt: string | null
    firstDeliveryDate: string | null
    pauseEvents: PauseEvent[]
  }
  const cards = new Map<string, Card>()
  const daily: Daily[] = []
  const adPeriods: MetaCardPeriod[] = []
  const config = settings(env)
  if (!config) return { cards: [], daily, adPeriods, ids: new Set<string>() }
  const [rows, history, events] = await env.DB.batch([
    env.DB.prepare(registryQuery).bind(config.accountId),
    env.DB.prepare(
      `SELECT ad_id AS adId,kind,since,MAX(until) AS until,payload
      FROM meta_ad_history WHERE account_id=? GROUP BY ad_id,kind,since ORDER BY since DESC,ad_id`,
    ).bind(config.accountId),
    env.DB.prepare(
      `SELECT ad_id AS adId,at,source,previous_active_at AS previousActiveAt,last_delivery_date AS lastDeliveryDate
      FROM meta_ad_pause_events WHERE account_id=? ORDER BY at DESC`,
    ).bind(config.accountId),
  ])
  const matches = new Map<string, string>()
  const priority: MetaAdAsset['status'][] = [
    'active',
    'scheduled',
    'unknown',
    'paused',
    'inactive',
    'archived',
  ]
  for (const row of rows.results as RegistryRow[]) {
    const id = publishedId(row)
    if (!id) continue
    matches.set(row.adId, id)
    const thumbnailUrl = row.thumbnailUpdatedAt
      ? '/api/meta-ads/thumbnail/' + row.publicKey
      : null
    const existing = cards.get(id)
    const firstDeliveryDate = earlier(
      existing?.firstDeliveryDate ?? null,
      row.firstDeliveryDate,
    )
    const startAt = earlier(existing?.startAt ?? null, row.startAt)
    if (
      !existing ||
      priority.indexOf(row.status) < priority.indexOf(existing.status)
    ) {
      cards.set(id, {
        id,
        title: row.title,
        status: row.status,
        statusObservedAt: row.statusObservedAt,
        startAt,
        firstDeliveryDate,
        pauseEvents: [],
        postUrl: row.postUrl,
        thumbnailUrl: thumbnailUrl ?? existing?.thumbnailUrl ?? null,
      })
    } else {
      existing.firstDeliveryDate = firstDeliveryDate
      existing.startAt = startAt
      if (!existing.thumbnailUrl && thumbnailUrl)
        existing.thumbnailUrl = thumbnailUrl
    }
  }
  const byAd = new Map<string, PauseEvent[]>()
  for (const { adId, ...event } of events.results as (PauseEvent & {
    adId: string
  })[]) {
    const list = byAd.get(adId) ?? []
    list.push(event)
    byAd.set(adId, list)
  }
  for (const [adId, list] of byAd) {
    const card = cards.get(matches.get(adId) ?? '')
    if (!card) continue
    for (const event of list) {
      if (
        event.source === 'observed' &&
        event.previousActiveAt &&
        list.some(
          (other) =>
            other.source === 'meta' &&
            other.at > event.previousActiveAt! &&
            other.at <= event.at,
        )
      )
        continue
      if (
        !card.pauseEvents.some(
          (other) => other.at === event.at && other.source === event.source,
        )
      )
        card.pauseEvents.push(event)
    }
  }
  for (const card of cards.values())
    card.pauseEvents.sort((a, b) => b.at.localeCompare(a.at))
  const grouped = new Map<
    string,
    { period: Period; cardId: string; rows: JsonObject[] }
  >()
  for (const record of history.results as (Omit<HistoryRow, 'payload'> & {
    payload: string
  })[]) {
    const cardId = matches.get(record.adId)
    if (!cardId) continue
    const values = JSON.parse(record.payload) as HistoryRow['payload']
    if (record.kind === 'day') {
      daily.push({
        ...values,
        adName: values.adName ?? cards.get(cardId)!.title,
        adId: record.adId,
        reviewedAdId: cardId,
        date: record.since,
      })
      continue
    }
    const key = JSON.stringify([cardId, record.kind, record.since])
    let group = grouped.get(key)
    if (!group || group.period.until < record.until) {
      group = {
        cardId,
        period: {
          kind: record.kind,
          since: record.since,
          until: record.until,
          spend: null,
          impressions: null,
          linkClicks: null,
          reach: null,
        },
        rows: [],
      }
      grouped.set(key, group)
    }
    if (group.period.until === record.until)
      group.rows.push({
        ad_id: record.adId,
        date_start: record.since,
        date_stop: record.until,
        spend: values.spend,
        impressions: values.impressions,
        inline_link_clicks: values.linkClicks,
        reach: values.reach,
      })
  }
  const daysByCard = new Map<string, Daily[]>()
  for (const day of daily) {
    const id = day.reviewedAdId!
    const days = daysByCard.get(id) ?? []
    days.push(day)
    daysByCard.set(id, days)
  }
  for (const { period, cardId, rows } of grouped.values()) {
    const expected = new Set(
      (daysByCard.get(cardId) ?? [])
        .filter((day) => day.date >= period.since && day.date <= period.until)
        .map((day) => day.adId),
    )
    adPeriods.push(
      ...cardPeriods(period, rows, new Map([[cardId, expected]]), matches),
    )
  }
  return {
    cards: [...cards.values()],
    daily,
    adPeriods,
    ids: new Set(cards.keys()),
  }
}

export async function readPublicMetaAds(env: Env) {
  const {
    status,
    lastSyncedAt,
    currency,
    timeZone,
    periods,
    daily: latestDaily,
    adPeriods: latestPeriods,
  } = await readSnapshot(env)
  const stored = await readCardHistory(env)
  const cards = stored.cards
  const daily = new Map(
    latestDaily.map((row) => [row.adId + '/' + row.date, row]),
  )
  for (const row of stored.daily) daily.set(row.adId + '/' + row.date, row)
  const adPeriods = new Map(
    stored.adPeriods.map((row) => [
      JSON.stringify([row.reviewedAdId, row.kind, row.since]),
      row,
    ]),
  )
  for (const row of latestPeriods) {
    if (!stored.ids.has(row.reviewedAdId)) continue
    const key = JSON.stringify([row.reviewedAdId, row.kind, row.since])
    // The current snapshot also records incomplete observations for the selected exact interval.
    if (!adPeriods.has(key) || adPeriods.get(key)!.until <= row.until)
      adPeriods.set(key, row)
  }
  return {
    status,
    lastSyncedAt,
    currency,
    timeZone,
    cards,
    periods: periods.map(
      ({ kind, since, until, spend, impressions, linkClicks, reach }) => ({
        kind,
        since,
        until,
        spend,
        impressions,
        linkClicks,
        reach,
      }),
    ),
    adPeriods: [...adPeriods.values()].map(
      ({
        reviewedAdId,
        kind,
        since,
        until,
        spend,
        impressions,
        linkClicks,
        reach,
      }) => ({
        reviewedAdId,
        kind,
        since,
        until,
        spend,
        impressions,
        linkClicks,
        reach,
      }),
    ),
    daily: [...daily.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(
        ({
          date,
          adName,
          spend,
          impressions,
          linkClicks,
          reviewedAdId,
          reach,
        }) => ({
          date,
          adName,
          spend,
          impressions,
          linkClicks,
          ...(reviewedAdId ? { reviewedAdId } : {}),
          ...(reach !== undefined ? { reach } : {}),
        }),
      ),
  }
}
