import type { Env } from './types'
import { settings, graph, amount, metrics } from './meta-ads'
import type {
  MetaLifetimeReport,
  MetaLifetimeRow,
} from '../src/lib/meta-ads-types'

interface AdIdentity {
  adId: string
  cardId: string
  created: string | null
}
interface SavedAd extends MetaLifetimeRow {
  adId: string
}
interface Cache {
  refreshed_at: string | null
  next_attempt: number
  status: MetaLifetimeReport['status']
  currency: string | null
  payload: string
}

function publicReport(
  cache: Cache | null,
  fallback: MetaLifetimeReport['status'] = 'pending',
): MetaLifetimeReport {
  const groups = new Map<string, MetaLifetimeRow>()
  const saved: SavedAd[] = JSON.parse(cache?.payload ?? '[]')
  for (const entry of saved) {
    const { adId: _privateId, ...row } = entry
    const prior = groups.get(row.reviewedAdId)
    if (!prior) {
      groups.set(row.reviewedAdId, row)
      continue
    }
    for (const key of ['spend', 'impressions', 'linkClicks'] as const) {
      const a = prior[key],
        b = row[key]
      prior[key] = a === null || b === null ? null : a + b
    }
    prior.reach = null
    prior.since = prior.since < row.since ? prior.since : row.since
    prior.until = prior.until < row.until ? prior.until : row.until
    prior.asOf = (prior.asOf ?? '') < (row.asOf ?? '') ? prior.asOf : row.asOf
    prior.complete =
      prior.complete &&
      row.complete &&
      prior.asOf === row.asOf &&
      prior.asOf === cache?.refreshed_at
  }
  return {
    status: cache?.status ?? fallback,
    asOf: cache?.refreshed_at ?? null,
    currency: cache?.currency ?? null,
    totals: [...groups.values()],
  }
}

function accountDay(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

export async function readMetaLifetime(
  env: Env,
  now = new Date(),
): Promise<MetaLifetimeReport> {
  const config = settings(env)
  if (!config) return publicReport(null, 'unconfigured')
  const id = config.accountId
  const state = () =>
    env.DB.prepare('SELECT * FROM meta_ad_lifetime_cache WHERE account_id=?')
      .bind(id)
      .first<Cache>()
  const cache = await state()
  const time = now.getTime()
  if (cache && cache.next_attempt > time) return publicReport(cache)
  const lease = crypto.randomUUID()
  const owned = await env.DB.prepare(
    `INSERT INTO meta_ad_lifetime_cache(account_id,next_attempt,lease) VALUES(?,?,?)
    ON CONFLICT(account_id) DO UPDATE SET next_attempt=excluded.next_attempt,lease=excluded.lease
    WHERE meta_ad_lifetime_cache.next_attempt<=?`,
  )
    .bind(id, time + 60000, lease, time)
    .run()
  if (!owned.meta.changes) return publicReport(await state())
  try {
    const [registry, meta] = await env.DB.batch([
      env.DB.prepare(
        `SELECT ad_id AS adId, COALESCE(reviewed_id,public_key) AS cardId,created_at AS created
        FROM meta_ad_registry WHERE account_id=? AND suppressed=0 ORDER BY ad_id`,
      ).bind(id),
      env.DB.prepare(
        'SELECT currency,time_zone FROM meta_ads_sync WHERE account_id=?',
      ).bind(id),
    ])
    const ads = registry.results as unknown as AdIdentity[]
    const location = meta.results[0] as
      | { currency: string | null; time_zone: string | null }
      | undefined
    const zone = location?.time_zone ?? 'UTC'
    const asOf = now.toISOString()
    const identities = new Map(ads.map((ad) => [ad.adId, ad]))
    const previous = new Map<string, SavedAd>()
    for (const row of JSON.parse(cache?.payload ?? '[]') as SavedAd[]) {
      const identity = identities.get(row.adId)
      if (identity)
        previous.set(row.adId, { ...row, reviewedAdId: identity.cardId })
    }
    const api = graph(config)
    const today = accountDay(asOf, zone)
    const covered = new Set<string>()
    for (let offset = 0; offset < ads.length; offset += 80) {
      const batch = ads.slice(offset, offset + 80)
      const created = batch.map(
        (ad) => ad.created && accountDay(ad.created, zone),
      )
      const oldest = created.every((date): date is string => !!date)
        ? created.sort()[0]
        : null
      // Ask explicitly for the entire span when within Meta's historical reporting window.
      // Older ads use the provider's maximum range and expose the returned bounds.
      const withinWindow =
        oldest &&
        Date.parse(today) - Date.parse(oldest) <= 36 * 30 * 86400000 &&
        oldest <= today
      const rows = await api.insights(
        withinWindow ? { since: oldest, until: today } : 'maximum',
        'ad',
        batch.map((ad) => ad.adId),
      )
      for (const row of rows) {
        const adId = String(row.ad_id)
        const ad = identities.get(adId)
        if (
          !ad ||
          !batch.some((item) => item.adId === adId) ||
          covered.has(adId)
        )
          throw new Error('unexpected_ad')
        const since = row.date_start,
          until = row.date_stop
        if (
          typeof since !== 'string' ||
          typeof until !== 'string' ||
          !/^\d{4}-\d\d-\d\d$/.test(since) ||
          !/^\d{4}-\d\d-\d\d$/.test(until) ||
          since > until
        )
          throw new Error('invalid_period')
        const createdDay = ad.created ? accountDay(ad.created, zone) : null
        const complete = !!createdDay && createdDay >= since && until >= today
        previous.set(adId, {
          adId,
          reviewedAdId: ad.cardId,
          ...metrics(row),
          reach: amount(row.reach, true),
          since: complete ? createdDay! : since,
          until,
          complete,
          asOf,
        })
        covered.add(adId)
      }
    }
    const totals = [...previous.values()]
    const incompleteCards = new Set(
      ads.filter((ad) => !covered.has(ad.adId)).map((ad) => ad.cardId),
    )
    for (const row of totals)
      if (incompleteCards.has(row.reviewedAdId)) row.complete = false
    await env.DB.prepare(
      `UPDATE meta_ad_lifetime_cache SET refreshed_at=?,status=?,currency=?,payload=?,lease=NULL
        WHERE account_id=? AND lease=?`,
    )
      .bind(
        asOf,
        ads.length ? 'ready' : 'pending',
        location?.currency ?? null,
        JSON.stringify(totals),
        id,
        lease,
      )
      .run()
  } catch {
    await env.DB.prepare(
      "UPDATE meta_ad_lifetime_cache SET status='error',lease=NULL WHERE account_id=? AND lease=?",
    )
      .bind(id, lease)
      .run()
  }
  return publicReport(await state())
}
