import { useEffect, useState } from 'react'

export function ConnectionLegalPage({ deletion }: { deletion: boolean }) {
  const code = new URLSearchParams(window.location.search).get('code')
  const [confirmation, setConfirmation] = useState('')
  useEffect(() => {
    if (!deletion || !code || !__INSTAGRAM_BACKEND__) return
    fetch('/api/data-deletion/' + encodeURIComponent(code), {
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('not_found')
        const data = await r.json()
        setConfirmation(
          data.status === 'deleted'
            ? '연결 정보와 로그인 세션 삭제가 완료되었습니다.'
            : '삭제 상태를 확인하지 못했습니다.',
        )
      })
      .catch(() =>
        setConfirmation(
          '삭제 확인 정보를 찾지 못했습니다. 서비스 관리자에게 문의해 주세요.',
        ),
      )
  }, [deletion, code])
  return (
    <main className="legal-page">
      <a href="/">← JB골프 대시보드</a>
      <p className="eyebrow">JB GOLF · ACCOUNT CONNECTION</p>
      <h1>{deletion ? '인스타그램 연결 정보 삭제' : '개인정보 처리 안내'}</h1>
      {deletion ? (
        <>
          <p>
            대시보드의 ‘계정 연결’에서 인스타그램으로 로그인한 뒤 ‘연결 해제’를
            선택하면 저장된 연결 정보와 모든 로그인 세션이 삭제됩니다.
          </p>
          <p>
            인스타그램에서 앱 연결을 해제하거나 데이터 삭제를 요청해 공식 삭제
            알림을 받으면 해당 계정의 저장된 연결 정보와 세션을 삭제합니다.
          </p>
          {code && (
            <p role="status">
              {confirmation || '삭제 상태를 확인하고 있습니다...'}
            </p>
          )}
        </>
      ) : (
        <>
          <h2>저장하는 정보와 목적</h2>
          <p>
            허용된 회사 인스타그램 계정을 식별하기 위해 계정 ID와 사용자 이름,
            연결 시각, 토큰 만료 시각을 저장합니다. 연결을 유지하는 액세스
            토큰은 서버 데이터베이스에 암호화해 보관하며 공개 페이지나 브라우저
            저장소에 넣지 않습니다.
          </p>
          <h2>이용과 보관</h2>
          <p>
            한 인스타그램 계정의 로그인과 연결 유지에 사용합니다. 연결 해제 시
            계정 정보·토큰·세션을 삭제합니다. 로그인 세션은 최대 30일이며,
            일회성 로그인 확인 정보는 10분 뒤 만료됩니다. 삭제 확인 기록에는
            개인 식별 정보를 넣지 않고 최대 30일 보관합니다.
          </p>
          <h2>현재 제공하지 않는 기능</h2>
          <p>
            이 인스타그램 로그인은 광고비·캠페인별 광고 실적 조회 권한을
            제공하지 않습니다. 광고 실적 연동은 광고 계정의 별도 승인을 구성한
            뒤 제공합니다.
          </p>
          <h2>저장 위치와 문의</h2>
          <p>
            연결 서비스는 Cloudflare Workers와 D1을 사용하도록 구성되어
            있습니다. 계정 데이터 확인·삭제 요청은 이 대시보드의 운영 담당자에게
            문의해 주세요.
          </p>
        </>
      )}
      <p className="legal-date">안내 작성일: 2026년 11월 5일</p>
    </main>
  )
}
