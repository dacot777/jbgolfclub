import type { Env } from './types'
import type {
  MetaAdsDaily as Daily,
  MetaAdsMetrics,
  MetaAdsPeriod as Period,
  MetaAdsReport as Report,
} from '../src/lib/meta-ads-types'

type DateRange = { since: string; until: string }

function settings(env: Env) {
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
function amount(value: unknown, integer = false) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error('invalid_metric')
  if (!/^\d+(?:\.\d+)?$/.test(String(value))) throw new Error('invalid_metric')
  const n = Number(value)
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)))
    throw new Error('invalid_metric')
  return n
}
function metrics(row: JsonObject): MetaAdsMetrics {
  return {
    spend: amount(row.spend),
    impressions: amount(row.impressions, true),
    linkClicks: amount(row.inline_link_clicks, true),
  }
}

function graph(config: NonNullable<ReturnType<typeof settings>>) {
  const account = new URL(
    `https://graph.facebook.com/${config.version}/act_${config.accountId}`,
  )
  let requests = 0
  async function get(url: URL) {
    // Leave headroom for D1 and the other scheduled Worker tasks on Workers Free.
    if (++requests > 30) throw new Error('meta_request_budget')
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
  async function insights(range: DateRange, daily: boolean) {
    const url = new URL(account.href + '/insights')
    url.search = new URLSearchParams({
      time_range: JSON.stringify({ since: range.since, until: range.until }),
      level: daily ? 'ad' : 'account',
      breakdowns: 'publisher_platform',
      fields:
        'date_start,date_stop,spend,impressions,inline_link_clicks,' +
        (daily ? 'ad_id,ad_name' : 'reach'),
      ...(daily ? { time_increment: '1' } : {}),
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
    const reports: {
      kind: string
      since: string
      payload: Period | Daily[]
    }[] = []
    for (const period of periods) {
      const rows = await api.insights(period, false)
      if (
        rows.length > 1 ||
        rows.some(
          (r) => r.date_start !== period.since || r.date_stop !== period.until,
        )
      )
        throw new Error('invalid_report_range')
      const row = rows[0] ?? {}
      reports.push({
        ...period,
        payload: { ...period, ...metrics(row), reach: amount(row.reach, true) },
      })
    }
    const byDay = new Map<string, Daily[]>()
    const seen = new Set<string>()
    for (const row of await api.insights(
      { since: earliest, until: today },
      true,
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
        ...metrics(row),
      })
      byDay.set(day, group)
    }
    // Include empty days so reruns also replace rows Meta has removed or re-attributed.
    for (let since = earliest; since <= today; since = daysFrom(since, 1))
      reports.push({ kind: 'day', since, payload: byDay.get(since) ?? [] })
    const serialized = JSON.stringify(reports)
    if (new TextEncoder().encode(serialized).byteLength > 750_000)
      throw new Error('report_too_large')
    // D1 executes a batch transactionally. A run that loses its lease cannot overwrite a later run.
    await env.DB.batch([
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
  } catch {
    await env.DB.prepare(
      `UPDATE meta_ads_sync SET status='error', active_run=NULL, lease_until=0
      WHERE account_id=? AND active_run=?`,
    )
      .bind(config.accountId, run)
      .run()
  }
}

export async function readMetaAds(env: Env): Promise<Report> {
  const config = settings(env)
  const empty: Report = {
    status: config ? 'pending' : 'unconfigured',
    lastSyncedAt: null,
    timeZone: null,
    currency: null,
    periods: [],
    daily: [],
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
      ON r.account_id=s.account_id AND r.run=s.published_run WHERE s.account_id=? ORDER BY r.since DESC`,
    ).bind(config.accountId),
  ])
  const state = stateResult.results[0]
  if (!state) return empty
  const report: Report = {
    ...empty,
    status: state.status as Report['status'],
    lastSyncedAt: state.synced_at as string | null,
    currency: state.currency as string | null,
    timeZone: state.time_zone as string | null,
  }
  for (const row of rowsResult.results) {
    const parsed = JSON.parse(row.payload as string)
    if (row.kind === 'day') report.daily.push(...parsed)
    else report.periods.push(parsed)
  }
  return report
}
