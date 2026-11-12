import type { Env } from './types'

export interface MetaAdAsset {
  adId: string
  title: string
  status:
    | 'active'
    | 'paused'
    | 'archived'
    | 'unknown'
    | 'scheduled'
    | 'inactive'
  postUrl: string | null
  thumbnailUrl: string | null
  creativeId: string | null
  instagram: boolean
  startAt: string | null
  createdAt: string | null
  pauseEvents?: { at: string; source: 'meta' }[]
}

interface AdRecord {
  id?: string
  name?: string
  created_time?: string
  effective_status?: string
  adset?: {
    id?: string
    effective_status?: string
    start_time?: string
    end_time?: string
    targeting?: {
      publisher_platforms?: string[]
      instagram_positions?: string[]
    }
  }
  campaign?: { id?: string; effective_status?: string }
  creative?: {
    id?: string
    instagram_permalink_url?: string
    thumbnail_url?: string
    image_url?: string
  }
}

const publicKeyPattern =
  /^meta-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const apiFields = [
  'id,name,created_time,effective_status',
  'adset{id,effective_status,start_time,end_time,targeting{publisher_platforms,instagram_positions}}',
  'campaign{id,effective_status}',
  'creative.thumbnail_width(320).thumbnail_height(320){id,instagram_permalink_url,thumbnail_url,image_url}',
].join(',')
const maxImageBytes = 256 * 1024
const imageBudgetPerAccount = 32 * 1024 * 1024

function timestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      value,
    )
  )
    return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function permalink(value?: string): string | null {
  if (typeof value !== 'string') return null
  const parts =
    /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(
      value,
    )
  return parts ? `https://www.instagram.com/${parts[1]}/${parts[2]}/` : null
}

function thumbnailSource(value?: string | null): URL | null {
  if (!value || !URL.canParse(value)) return null
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null
  if (
    url.searchParams.has('access_token') ||
    url.searchParams.has('appsecret_proof')
  )
    return null
  if (
    url.hostname.endsWith('.fbcdn.net') ||
    url.hostname.endsWith('.cdninstagram.com')
  )
    return url
  if (url.hostname === 'www.facebook.com' && url.pathname === '/ads/image/')
    return url
  return null
}

function deliveryStatus(ad: AdRecord, now: Date): MetaAdAsset['status'] {
  const states = [
    ad.effective_status,
    ad.adset?.effective_status,
    ad.campaign?.effective_status,
  ]
  if (states.some((s) => s === 'ARCHIVED' || s === 'DELETED')) return 'archived'
  if (
    states.some(
      (s) => s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED',
    )
  )
    return 'paused'
  if (states.some((s) => s === 'DISAPPROVED' || s === 'PENDING_BILLING_INFO'))
    return 'inactive'
  if (Date.parse(ad.adset?.end_time ?? '') <= now.getTime()) return 'inactive'
  const future = Date.parse(ad.adset?.start_time ?? '') > now.getTime()
  if (
    future &&
    ['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED'].includes(
      ad.effective_status ?? '',
    )
  )
    return 'scheduled'
  if (ad.effective_status === 'ACTIVE') return 'active'
  return 'unknown'
}

function asset(
  ad: AdRecord,
  knownIds: Set<string>,
  now: Date,
): MetaAdAsset | null {
  if (
    !ad ||
    typeof ad.id !== 'string' ||
    !/^\d+$/.test(ad.id) ||
    typeof ad.name !== 'string' ||
    !ad.name.trim()
  )
    return null
  const postUrl = permalink(ad.creative?.instagram_permalink_url)
  const targeting = ad.adset?.targeting
  const platforms = targeting?.publisher_platforms
  const hasInstagram =
    Array.isArray(platforms) && platforms.length
      ? platforms.includes('instagram')
      : !!postUrl ||
        (Array.isArray(targeting?.instagram_positions) &&
          targeting.instagram_positions.length > 0)
  const known = knownIds.has(ad.id)
  if (!hasInstagram && !known) return null
  const status = deliveryStatus(ad, now)
  if (!known && status !== 'active' && status !== 'scheduled') return null
  return {
    adId: ad.id,
    title: ad.name.trim().slice(0, 512),
    status,
    postUrl,
    thumbnailUrl:
      thumbnailSource(ad.creative?.thumbnail_url)?.href ??
      thumbnailSource(ad.creative?.image_url)?.href ??
      null,
    creativeId:
      typeof ad.creative?.id === 'string' && /^\d+$/.test(ad.creative.id)
        ? ad.creative.id
        : null,
    instagram: !!hasInstagram || known,
    startAt: timestamp(ad.adset?.start_time),
    createdAt: timestamp(ad.created_time),
  }
}

interface StatusActivity {
  event_type?: string
  event_time?: string
  object_id?: string
  extra_data?: string | Record<string, unknown>
}

const statusChanges = new Set([
  'update_ad_run_status',
  'update_ad_set_run_status',
  'update_campaign_run_status',
])

function explicitPause(
  activity: StatusActivity,
  currentlyPaused: boolean,
): boolean {
  let changes = activity.extra_data
  if (typeof changes === 'string') {
    try {
      changes = JSON.parse(changes)
    } catch {
      return false
    }
  }
  if (!changes || typeof changes !== 'object') return false
  const previous = String(changes.old_value ?? '')
    .trim()
    .toUpperCase()
  const next = String(changes.new_value ?? '')
    .trim()
    .toUpperCase()
  if (next === 'PAUSED') return previous !== next
  // Meta's English activity log can use "Inactive" (code 15) for a manual pause.
  // Corroborate its latest change with PAUSED on that same entity, not an inherited state.
  const codes = changes.run_status as
    | { old_value?: number; new_value?: number }
    | undefined
  return (
    currentlyPaused &&
    changes.type === 'run_status' &&
    previous === 'ACTIVE' &&
    next === 'INACTIVE' &&
    codes?.old_value === 1 &&
    codes?.new_value === 15
  )
}

/** Discover currently eligible ads, then look up previously observed ads even after delivery stops. */
export async function discoverInstagramAds(
  env: Env,
  accountId: string,
  knownAdIds: string[],
  now = new Date(),
): Promise<MetaAdAsset[]> {
  if (
    !/^\d+$/.test(accountId) ||
    !env.META_ADS_ACCESS_TOKEN ||
    !/^v\d+\.0$/.test(env.META_ADS_API_VERSION ?? '')
  )
    return []
  const base = `https://graph.facebook.com/${env.META_ADS_API_VERSION}/`
  let calls = 0
  async function read(url: URL) {
    calls++
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('meta_inventory_unavailable')
    return response.json<Record<string, unknown>>()
  }
  const known = new Set(knownAdIds.filter((id) => /^\d+$/.test(id)))
  const seen = new Map<string, MetaAdAsset>()
  const descendants = new Map<string, Set<string>>()
  const pausedObjects = new Set<string>()
  function consider(ad: AdRecord) {
    const item = asset(ad, known, now)
    if (!item) return
    seen.set(item.adId, item)
    for (const entity of [ad, ad.adset, ad.campaign]) {
      const id = entity?.id
      if (!id || !/^\d+$/.test(id)) continue
      if (entity?.effective_status === 'PAUSED') pausedObjects.add(id)
      const matches = descendants.get(id) ?? new Set<string>()
      matches.add(item.adId)
      descendants.set(id, matches)
    }
  }
  const list = new URL('act_' + accountId + '/ads', base)
  list.searchParams.set('fields', apiFields)
  list.searchParams.set(
    'effective_status',
    JSON.stringify(['ACTIVE', 'PENDING_REVIEW', 'IN_PROCESS']),
  )
  list.searchParams.set('limit', '100')
  try {
    for (let page = 0; page < 3; page++) {
      const result = await read(list)
      if (!Array.isArray(result.data)) break
      result.data.forEach(consider)
      const paging = result.paging as
        | { next?: string; cursors?: { after?: string } }
        | undefined
      const after = paging?.cursors?.after
      if (
        !paging?.next ||
        typeof after !== 'string' ||
        !after ||
        list.searchParams.get('after') === after
      )
        break
      list.searchParams.set('after', after)
    }
  } catch {
    // The independent known-ID lookup can still refresh ads filtered out of the list.
  }
  const missing = [...known].filter((id) => !seen.has(id)).slice(0, 100)
  // Individual object lookups work even when a portfolio's multi-ID expansion returns no ad.
  for (
    let index = 0;
    missing.length > 2 && index < missing.length;
    index += 50
  ) {
    const ids = missing.slice(index, index + 50)
    const url = new URL(base)
    url.searchParams.set('ids', ids.join(','))
    url.searchParams.set('fields', apiFields)
    try {
      const result = await read(url)
      for (const id of ids) {
        const row = result[id] as AdRecord | undefined
        if (row?.id === id) consider(row)
      }
    } catch {
      // No observation on a failed page. The caller retains recorded statuses.
    }
  }
  const remaining = missing.filter((id) => !seen.has(id))
  const offset =
    remaining.length > 2
      ? Math.floor(now.getTime() / 3600000) % remaining.length
      : 0
  for (const id of [
    ...remaining.slice(offset),
    ...remaining.slice(0, offset),
  ]) {
    if (calls >= 5) break
    const url = new URL(id, base)
    url.searchParams.set('fields', apiFields)
    try {
      const row = (await read(url)) as AdRecord
      if (row.id === id) consider(row)
    } catch {
      // Prior delivery already proves Instagram placement, so retry without targeting expansion.
      if (calls >= 5) continue
      url.searchParams.set(
        'fields',
        'id,name,created_time,effective_status,adset{id,effective_status,start_time,end_time},campaign{id,effective_status},creative{id,instagram_permalink_url,thumbnail_url}',
      )
      try {
        const row = (await read(url)) as AdRecord
        if (row.id === id) consider(row)
      } catch {
        /* Keep the previously published state when the object cannot be read. */
      }
    }
  }
  if (seen.size) {
    // One page of status changes, including historical pauses of currently resumed ads.
    const activities = new URL('act_' + accountId + '/activities', base)
    activities.searchParams.set(
      'fields',
      'event_type,event_time,object_id,extra_data',
    )
    activities.searchParams.set('category', 'STATUS')
    activities.searchParams.set('locale', 'en_US')
    activities.searchParams.set('limit', '100')
    activities.searchParams.set(
      'since',
      String(Math.floor(now.getTime() / 1000) - 90 * 86400),
    )
    try {
      const { data } = await read(activities)
      const events = (Array.isArray(data) ? (data as StatusActivity[]) : [])
        .flatMap((event) => {
          const at = timestamp(event?.event_time)
          return at &&
            Date.parse(at) <= now.getTime() &&
            event.object_id &&
            descendants.has(event.object_id) &&
            statusChanges.has(event.event_type ?? '')
            ? [{ event, id: event.object_id, at }]
            : []
        })
        .sort((a, b) => b.at.localeCompare(a.at))
      const changedObjects = new Set<string>()
      for (const { event, id, at } of events) {
        const currentlyPaused = !changedObjects.has(id) && pausedObjects.has(id)
        changedObjects.add(id)
        if (!explicitPause(event, currentlyPaused)) continue
        for (const adId of descendants.get(id) ?? []) {
          const item = seen.get(adId)!
          // A campaign/ad set can predate a newly added ad. Only inherit events after that ad existed.
          if (
            (!item.createdAt && adId !== event.object_id) ||
            (item.createdAt && item.createdAt > at)
          )
            continue
          item.pauseEvents ??= []
          if (!item.pauseEvents.some((e) => e.at === at))
            item.pauseEvents.push({ at, source: 'meta' })
        }
      }
    } catch {
      // No exact transition timestamp is supplied when the activity log is unavailable.
    }
  }
  return [...seen.values()]
}

function imageType(bytes: Uint8Array) {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  if (
    [0x89, 0x50, 0x4e, 0x47, 0xd, 0xa, 0x1a, 0xa].every(
      (n, i) => bytes[i] === n,
    )
  )
    return 'image/png'
  const prefix = String.fromCharCode(...bytes.slice(0, 12))
  if (prefix.startsWith('RIFF') && prefix.slice(8) === 'WEBP')
    return 'image/webp'
  if (prefix.startsWith('GIF87a') || prefix.startsWith('GIF89a'))
    return 'image/gif'
  return null
}

async function imageBytes(response: Response): Promise<Uint8Array | null> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get('content-length')) > maxImageBytes
  ) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body.getReader()
  const bytes = new Uint8Array(maxImageBytes)
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return bytes.slice(0, size)
    if (chunk.value.byteLength + size > maxImageBytes) {
      await reader.cancel()
      return null
    }
    bytes.set(chunk.value, size)
    size += chunk.value.byteLength
  }
}

export async function syncMetaAdThumbnail(
  env: Env,
  publicKey: string,
  remoteUrl: string | null,
  creativeId: string | null,
): Promise<boolean> {
  const accountId = env.META_AD_ACCOUNT_ID?.replace(/^act_/, '')
  if (!accountId || !publicKeyPattern.test(publicKey)) return false
  const previous = await env.DB.prepare(
    'SELECT creative_id FROM meta_ad_thumbnails WHERE public_key=? AND account_id=?',
  )
    .bind(publicKey, accountId)
    .first<{ creative_id: string | null }>()
  const source = thumbnailSource(remoteUrl)
  if (!source || (previous && previous.creative_id === creativeId))
    return !!previous
  try {
    // Fetch only the provider-issued image. Never forward the account's bearer token to its CDN.
    const options = {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
    } as const
    let response = await fetch(source, options)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location')
      await response.body?.cancel()
      const next = location && thumbnailSource(new URL(location, source).href)
      if (!next) return !!previous
      response = await fetch(next, options)
    }
    const bytes = await imageBytes(response)
    const type = bytes && imageType(bytes)
    if (!bytes || !type) return !!previous
    const result = await env.DB.prepare(
      `
      INSERT INTO meta_ad_thumbnails (public_key, account_id, creative_id, content_type, data, updated_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE (SELECT COALESCE(SUM(length(data)), 0) FROM meta_ad_thumbnails WHERE account_id=? AND public_key<>?) + ? <= ?
      ON CONFLICT(public_key) DO UPDATE SET creative_id=excluded.creative_id, content_type=excluded.content_type,
      data=excluded.data, updated_at=excluded.updated_at WHERE meta_ad_thumbnails.account_id=excluded.account_id`,
    )
      .bind(
        publicKey,
        accountId,
        creativeId,
        type,
        bytes,
        new Date().toISOString(),
        accountId,
        publicKey,
        bytes.byteLength,
        imageBudgetPerAccount,
      )
      .run()
    return result.meta.changes > 0 || !!previous
  } catch {
    return !!previous
  }
}

export async function getMetaAdThumbnail(
  env: Env,
  publicKey: string,
): Promise<Response> {
  const accountId = env.META_AD_ACCOUNT_ID?.replace(/^act_/, '')
  if (accountId && publicKeyPattern.test(publicKey)) {
    const stored = await env.DB.prepare(
      'SELECT content_type, data FROM meta_ad_thumbnails WHERE public_key=? AND account_id=?',
    )
      .bind(publicKey, accountId)
      .first<{ content_type: string; data: number[] | ArrayBuffer }>()
    if (
      stored &&
      ['image/jpeg', 'image/webp', 'image/png', 'image/gif'].includes(
        stored.content_type,
      )
    ) {
      const bytes = new Uint8Array(stored.data)
      return new Response(bytes, {
        headers: {
          'Content-Type': stored.content_type,
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  }
  return new Response(null, {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })
}
