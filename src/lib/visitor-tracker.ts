import { useEffect } from 'react'
import {
  ANALYTICS_MENUS,
  type AnalyticsEvent,
  type AnalyticsMenu,
} from './analytics-types'

const STORAGE_KEY = 'jbgolf-analytics-visit'
const VISIT_TIMEOUT = 30 * 60 * 1000
const HEARTBEAT = 30 * 1000
type Visit = { id: string; touchedAt: number }
type View = {
  visitId: string
  id: string
  menu: AnalyticsMenu
  seq: number
  activeMs: number
  runningSince: number | null
  ended: boolean
}
let memoryVisit: Visit | null = null
let cookieReady = false
let deliveries: Promise<void> = Promise.resolve()

function remember(visit: Visit) {
  memoryVisit = visit
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(visit))
  } catch {
    // Restricted storage must not prevent access to the website.
  }
}

function currentVisit(): Visit {
  let previous = memoryVisit
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) {
      const value = JSON.parse(stored) as Visit
      if (
        typeof value.id === 'string' &&
        /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value.id) &&
        typeof value.touchedAt === 'number' &&
        Number.isFinite(value.touchedAt)
      )
        previous = value
    }
  } catch {
    // Use only this page's anonymous in-memory identity when storage is denied.
  }
  const now = Date.now()
  const visit =
    previous &&
    now >= previous.touchedAt &&
    now - previous.touchedAt < VISIT_TIMEOUT
      ? previous
      : { id: crypto.randomUUID(), touchedAt: now }
  remember(visit)
  return visit
}

function touchVisit(id: string) {
  const previous = memoryVisit
  const now = Date.now()
  if (
    previous?.id === id &&
    now >= previous.touchedAt &&
    now - previous.touchedAt < VISIT_TIMEOUT
  )
    remember({ id, touchedAt: now })
}

function privacyPreference() {
  return (
    navigator.doNotTrack === '1' ||
    (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl === true
  )
}

function send(event: AnalyticsEvent, urgent: boolean) {
  const body = JSON.stringify(event)
  if (urgent && cookieReady && typeof navigator.sendBeacon === 'function') {
    try {
      if (
        navigator.sendBeacon(
          '/api/analytics/event',
          new Blob([body], { type: 'application/json' }),
        )
      )
        return
    } catch {
      // Fall back to keepalive fetch without interrupting navigation.
    }
  }
  // The first response establishes the server's HttpOnly visitor cookie. Racing
  // a pause/leave or another view ahead of it would create conflicting visitors.
  // Keep queued delivery alive when possible; never try to read that cookie.
  deliveries = deliveries.then(async () => {
    try {
      const response = await fetch('/api/analytics/event', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: urgent || event.phase === 'leave',
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) cookieReady = true
    } catch {
      // Analytics is best effort; browser/network restrictions are not page errors.
    }
  })
}

/** Measures public-menu foreground time; never sends form contents or URLs. */
export function useVisitorTracker(menu: AnalyticsMenu | null) {
  useEffect(() => {
    if (
      !__INSTAGRAM_BACKEND__ ||
      !menu ||
      !ANALYTICS_MENUS.includes(menu) ||
      privacyPreference()
    )
      return
    let cancelled = false
    let dispose: (() => void) | undefined
    // React's development StrictMode immediately cleans up its first effect.
    // Starting after that probe avoids recording a visitor who never saw a view.
    queueMicrotask(() => {
      if (cancelled) return
      try {
        let view: View
        function emit(phase: AnalyticsEvent['phase'], urgent = false) {
          const time = performance.now()
          if (view.runningSince !== null) {
            view.activeMs += Math.max(0, time - view.runningSince)
            view.runningSince = time
          }
          touchVisit(view.visitId)
          send(
            {
              visitId: view.visitId,
              viewId: view.id,
              menu: view.menu,
              seq: ++view.seq,
              phase,
              activeMs: Math.floor(view.activeMs),
            },
            urgent,
          )
        }
        function start(visit = currentVisit()) {
          view = {
            visitId: visit.id,
            id: crypto.randomUUID(),
            menu: menu!,
            seq: 0,
            activeMs: 0,
            runningSince:
              document.visibilityState === 'visible' ? performance.now() : null,
            ended: false,
          }
          emit('enter')
          if (view.runningSince === null) emit('pause')
        }
        function finish(urgent: boolean) {
          if (view.ended) return
          emit('leave', urgent)
          view.runningSince = null
          view.ended = true
        }
        function visibility() {
          if (view.ended) return
          if (document.visibilityState !== 'visible') {
            if (view.runningSince !== null) {
              emit('pause', true)
              view.runningSince = null
            }
            return
          }
          if (view.runningSince !== null) return
          const visit = currentVisit()
          if (visit.id !== view.visitId) {
            finish(false)
            start(visit)
          } else {
            view.runningSince = performance.now()
            emit('resume')
          }
        }
        const pageHide = () => finish(true)
        const pageShow = () => {
          if (view.ended) start()
        }
        start()
        document.addEventListener('visibilitychange', visibility)
        window.addEventListener('pagehide', pageHide)
        window.addEventListener('pageshow', pageShow)
        const timer = window.setInterval(() => {
          if (
            !view.ended &&
            document.visibilityState === 'visible' &&
            view.runningSince !== null
          )
            emit('heartbeat')
        }, HEARTBEAT)
        dispose = () => {
          window.clearInterval(timer)
          document.removeEventListener('visibilitychange', visibility)
          window.removeEventListener('pagehide', pageHide)
          window.removeEventListener('pageshow', pageShow)
          finish(false)
        }
      } catch {
        // Unsupported/restricted browser features must never affect the app.
      }
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [menu])
}
