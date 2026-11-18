import { useState } from 'react'
import {
  Camera,
  Check,
  CircleAlert,
  Eye,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { InstagramConnectionModel } from '@/lib/instagram-connection'
import { COMPANY_INSTAGRAM } from '@/lib/company-instagram'

export function InstagramConnectPanel({
  model,
  onSample,
  onReport,
}: {
  model: InstagramConnectionModel
  onSample: () => void
  onReport: () => void
}) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const { enabled, status, loading, error, busy } = model
  if (loading)
    return (
      <p className="connection-feedback" role="status">
        연결 상태를 확인하고 있습니다...
      </p>
    )
  if (error)
    return (
      <div className="connection-feedback">
        <p role="alert">{error}</p>
        <Button variant="outline" onClick={() => void model.reload()}>
          다시 확인
        </Button>
      </div>
    )
  const connected = status?.authenticated && status.connection
  return (
    <div className="instagram-connect-panel">
      <div className="instagram-identity">
        <span className="instagram-identity-icon">
          <Camera size={25} aria-hidden="true" />
        </span>
        <div>
          <strong>
            {connected
              ? `@${connected.username}`
              : status?.targetUsername
                ? `@${status.targetUsername}`
                : `@${COMPANY_INSTAGRAM.username}`}
          </strong>
          <span>인스타그램 계정 1개만 연결</span>
        </div>
        {connected && (
          <Badge variant="secondary">
            <Check aria-hidden="true" />
            연결됨
          </Badge>
        )}
      </div>
      {connected ? (
        <>
          <div className="connection-facts">
            <p>
              <span>인스타그램 연결</span>
              <strong>
                {connected.needsReconnect ? '재연결 필요' : '연결 완료'}
              </strong>
            </p>
            <p>
              <span>광고 실적 확인</span>
              <strong>광고별 상세 실적</strong>
            </p>
          </div>
          <p className="connection-explanation">
            인스타그램 프로필이 연결되었습니다. 광고 실적은 각 게시물의 상세
            카드에서 확인할 수 있습니다.
          </p>
          {connected.refreshWarning && (
            <p className="connection-warning" role="status">
              <CircleAlert size={16} aria-hidden="true" />
              {connected.needsReconnect
                ? '연결을 갱신하려면 같은 계정으로 다시 로그인해 주세요.'
                : '자동 갱신이 일시적으로 실패해 기존 연결 정보를 유지하고 있습니다.'}
            </p>
          )}
          {connected.needsReconnect && (
            <form action="/api/auth/instagram/start" method="post">
              <Button type="submit">
                <Camera aria-hidden="true" />
                인스타그램으로 다시 로그인
              </Button>
            </form>
          )}
          {confirmDisconnect ? (
            <div className="disconnect-confirm">
              <p>저장된 연결 정보와 로그인 세션을 삭제할까요?</p>
              <div>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await model.disconnect()
                    setConfirmDisconnect(false)
                  }}
                  disabled={busy}
                >
                  {busy ? '처리 중...' : '연결 해제'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmDisconnect(false)}
                  disabled={busy}
                >
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <div className="connection-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void model.logout()}
              >
                로그아웃
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmDisconnect(true)}
              >
                연결 해제
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {!enabled || !status?.configured ? (
            <div className="connection-setup-note">
              <LockKeyhole size={19} aria-hidden="true" />
              <div>
                <strong>
                  실제 계정 연결 기능은 아직 활성화되지 않았습니다.
                </strong>
                <p>
                  인스타그램 공식 로그인에 필요한 앱과 무료 연결 서버를 준비하고
                  있습니다. 준비 전에는 로그인 정보를 입력받지 않습니다.
                </p>
              </div>
            </div>
          ) : (
            <>
              <p className="connection-explanation">
                인스타그램의 공식 로그인 화면에서 회사 계정으로 승인해 주세요.
                이 사이트에서는 인스타그램 비밀번호를 입력받지 않습니다.
              </p>
              <form action="/api/auth/instagram/start" method="post">
                <Button type="submit" className="instagram-login-button">
                  <Camera aria-hidden="true" />
                  인스타그램으로 로그인하여 연결
                </Button>
              </form>
            </>
          )}
          <p className="connection-warning">
            <CircleAlert size={17} aria-hidden="true" />
            인스타그램 로그인만으로 광고비 조회 권한이 생기지는 않습니다.
            {enabled &&
              ' 집행한 광고의 수치는 광고별 상세 실적에서 확인하세요.'}
          </p>
          <Button variant="outline" onClick={onSample}>
            <Eye aria-hidden="true" />
            예시 데이터로 화면 둘러보기
          </Button>
        </>
      )}
      <p className="dialog-note">
        <ShieldCheck size={17} aria-hidden="true" />
        연결 정보는 서버에 암호화해 보관합니다.
      </p>
      {enabled && (
        <div className="connection-legal">
          <a href="#campaigns" onClick={onReport}>
            광고별 상세 실적
          </a>
          <a href="/privacy" target="_blank" rel="noreferrer">
            개인정보 처리 안내
          </a>
          <a href="/data-deletion" target="_blank" rel="noreferrer">
            연결 정보 삭제
          </a>
        </div>
      )}
    </div>
  )
}
