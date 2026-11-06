import { useEffect, useState } from 'react'
import type { MediaFeed, MediaKind } from './media-types'

const pendingRequests = new Map<MediaKind, Promise<MediaFeed>>()
const recentFeeds = new Map<MediaKind, MediaFeed>()
const MAX_POLLS = 18
const POLL_DELAY = 600

function validLink(value: unknown) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function validateFeed(value: unknown, kind: MediaKind): MediaFeed {
  const feed = value as MediaFeed
  if (
    !feed ||
    feed.kind !== kind ||
    !Array.isArray(feed.keywords) ||
    !feed.keywords.every((keyword) => typeof keyword === 'string') ||
    !Array.isArray(feed.items) ||
    !['fresh', 'partial', 'cached', 'unavailable'].includes(feed.status) ||
    typeof feed.refreshing !== 'boolean' ||
    !Number.isSafeInteger(feed.successfulQueries) ||
    !Number.isSafeInteger(feed.totalQueries) ||
    feed.successfulQueries < 0 ||
    feed.totalQueries < 0 ||
    feed.successfulQueries > feed.totalQueries ||
    !feed.items.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.publisher === 'string' &&
        (item.author === null || typeof item.author === 'string') &&
        (item.thumbnailUrl === null || typeof item.thumbnailUrl === 'string') &&
        (item.publishedAt === null || typeof item.publishedAt === 'string') &&
        typeof item.firstSeenAt === 'string' &&
        validLink(item.url) &&
        Array.isArray(item.matchedKeywords) &&
        item.matchedKeywords.every((keyword) => typeof keyword === 'string'),
    )
  )
    throw new Error('invalid_media_feed')
  return feed
}

function requestFeed(kind: MediaKind) {
  const running = pendingRequests.get(kind)
  if (running) return running
  const request = (async () => {
    const response = await fetch(`/api/media?kind=${kind}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('media_unavailable')
    return validateFeed(await response.json(), kind)
  })()
  pendingRequests.set(kind, request)
  void request
    .finally(() => {
      if (pendingRequests.get(kind) === request) pendingRequests.delete(kind)
    })
    .catch(() => {})
  return request
}

type FeedState = {
  kind: MediaKind
  data: MediaFeed | null
  loading: boolean
  checking: boolean
  error: string
}

export function useMediaFeed(kind: MediaKind) {
  const [state, setState] = useState<FeedState>(() => ({
    kind,
    data: recentFeeds.get(kind) ?? null,
    loading: !recentFeeds.has(kind),
    checking: true,
    error: '',
  }))
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const deadline = Date.now() + 90000
    setState({
      kind,
      data: recentFeeds.get(kind) ?? null,
      loading: !recentFeeds.has(kind),
      checking: true,
      error: '',
    })
    async function check() {
      try {
        const data = await requestFeed(kind)
        if (!active) return
        recentFeeds.set(kind, data)
        const continueChecking =
          data.refreshing && attempts < MAX_POLLS && Date.now() < deadline
        setState({
          kind,
          data,
          loading: false,
          checking: continueChecking,
          error:
            data.refreshing && !continueChecking
              ? '최신 확인이 지연되고 있습니다. 다음에 이 메뉴를 열면 다시 확인합니다.'
              : '',
        })
        if (continueChecking) {
          attempts += 1
          timer = setTimeout(() => {
            void check()
          }, POLL_DELAY)
        }
      } catch {
        if (!active) return
        setState((previous) => ({
          kind,
          data:
            previous.kind === kind
              ? previous.data
              : (recentFeeds.get(kind) ?? null),
          loading: false,
          checking: false,
          error:
            '검색 연결이 잠시 지연되고 있습니다. 다음에 이 메뉴를 열면 다시 확인합니다.',
        }))
      }
    }
    void check()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [kind])
  return state.kind === kind
    ? state
    : {
        kind,
        data: recentFeeds.get(kind) ?? null,
        loading: !recentFeeds.has(kind),
        checking: true,
        error: '',
      }
}
