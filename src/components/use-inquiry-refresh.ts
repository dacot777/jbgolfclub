import { useEffect, useEffectEvent } from 'react'

export function useInquiryRefresh(enabled: boolean, refresh: () => void) {
  const run = useEffectEvent(refresh)
  useEffect(() => {
    if (!enabled) return
    let timer: number | undefined
    let lastRun = -Infinity
    function check() {
      window.clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      // Returning from the browser cache can fire both pageshow and visibilitychange.
      if (performance.now() - lastRun > 1000) {
        lastRun = performance.now()
        run()
      }
      timer = window.setTimeout(check, 60_000)
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) check()
    }
    if (document.visibilityState === 'visible')
      timer = window.setTimeout(check, 60_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', restore)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', restore)
    }
  }, [enabled])
}
