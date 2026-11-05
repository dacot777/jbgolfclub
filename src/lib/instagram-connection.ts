import { useCallback, useEffect, useState } from 'react'

export interface InstagramConnection {
  configured: boolean
  authenticated: boolean
  advertisingAccess: boolean
  csrfToken?: string
  targetUsername?: string
  connection: null | {
    username: string
    userId: string
    connectedAt: number
    tokenExpiresAt: number
    needsReconnect: boolean
    refreshWarning: boolean
  }
}
export const instagramErrors: Record<string, string> = {
  invalid_state:
    '로그인 확인 정보가 일치하지 않습니다. 인스타그램 로그인을 다시 시작해 주세요.',
  expired_state: '로그인 시간이 만료됐습니다. 다시 시작해 주세요.',
  authorization_cancelled: '인스타그램 로그인을 취소했습니다.',
  different_instagram_account:
    '설정된 회사 인스타그램 계정으로 로그인해 주세요. 다른 계정은 연결할 수 없습니다.',
  instagram_authorization_failed:
    '인스타그램에서 연결을 승인하지 않았습니다. 앱 권한과 계정 유형을 확인해 주세요.',
  instagram_unreachable:
    '인스타그램 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
  instagram_rate_limited:
    '인스타그램 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  server_not_configured: '연결 서비스의 설정이 아직 완료되지 않았습니다.',
}

export function useInstagramConnection() {
  const enabled = __INSTAGRAM_BACKEND__
  const [status, setStatus] = useState<InstagramConnection | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/connection', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('status_failed')
      setStatus(await response.json())
    } catch {
      setError('연결 상태를 확인하지 못했습니다. 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [enabled])
  useEffect(() => {
    void reload()
  }, [reload])
  async function action(path: string, method: 'POST' | 'DELETE') {
    if (!enabled || !status?.csrfToken) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': status.csrfToken },
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('action_failed')
      await reload()
    } catch {
      setError(
        '요청을 처리하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.',
      )
    } finally {
      setBusy(false)
    }
  }
  return {
    enabled,
    status,
    loading,
    error,
    busy,
    reload,
    disconnect: () => action('/api/connection', 'DELETE'),
    logout: () => action('/api/auth/logout', 'POST'),
  }
}
export type InstagramConnectionModel = ReturnType<typeof useInstagramConnection>
