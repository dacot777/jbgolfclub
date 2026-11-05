# Meta 계정 연결 — 관리자 확인 메모

상태: **관리자 확인 대기** · 확인일: 2026-11-05.

## 현재까지 완료한 작업

- 연결용 사이트: https://jbgolf-connection.jbgolfacademy.workers.dev/
- Workers Free와 D1 무료 범위에 서버·데이터베이스·암호화 키 설정 완료.
- 회사 연결 대상은 `@jbgolfacademy` 한 계정으로 고정.
- 홈페이지와 연결 상태 API, 로컬 서버 검사 9개, 실제 공개 사이트의 브라우저 렌더링 확인 완료.

**실제 Instagram 로그인, 광고 계정 조회 권한, 매시간 광고 실적 수집은 아직 완료되지 않았습니다.** 화면의 예시 수치는 실제 광고 실적이 아닙니다.

## 현재 확인한 막힌 지점

Instagram으로 로그인한 Business Suite의 회사 앱 목록에 ‘추가된 앱 없음’이 표시됩니다. 추가 메뉴의 ‘새 앱 ID 만들기’는 회색으로 비활성화되어 있습니다. ‘앱 ID 연결’과 ‘액세스 권한 요청’은 이미 존재하는 앱 ID를 전제로 하는 메뉴입니다.

비활성화의 정확한 원인은 확인되지 않았습니다. 이 화면만으로 특정 관리자의 권한이나 계정 상태를 단정하지 않습니다. 사용자는 Facebook 계정 사용을 원하지 않으므로, 신규 Facebook 로그인·가입 또는 다른 사람의 계정 사용을 요청하며 진행하지 않습니다.

## 관리자가 나중에 확인할 내용

1. 회사에서 이미 소유하거나 정식으로 사용할 수 있는 Meta 앱이 있는지 확인합니다. 현재 포트폴리오의 빈 목록만으로 다른 곳에 앱이 전혀 없다고 단정하지 않습니다.
2. 현재 계정의 앱 관리 권한과 새 앱 생성이 제한된 이유를 확인합니다. 비즈니스 관리 권한과 개발자 등록은 구분합니다.
3. 사용할 수 있는 앱이 확인되면 **Instagram API with Instagram Login** 설정 가능 여부와 프로페셔널 계정·테스터 승인 조건을 확인합니다.
4. 실제 광고비와 캠페인 실적은 별도의 Marketing API 읽기 권한이 필요합니다. Instagram 프로필 로그인 성공만으로 광고 권한이 생기지 않습니다.

계정 소유자가 본인 인증을 직접 처리합니다. 비밀번호·인증번호를 공유하거나 대신 로그인하도록 요청할 필요가 없습니다. 관리자 진행 방식은 사용자와 계정 소유자가 결정한 후 이어갑니다.

## 앱 설정 시 사용할 준비된 값

| 항목 | 값 |
| --- | --- |
| 앱 이름 후보 | `JB Golf Report` |
| 대상 Instagram | `jbgolfacademy` |
| 사이트 | https://jbgolf-connection.jbgolfacademy.workers.dev/ |
| OAuth Redirect URI | https://jbgolf-connection.jbgolfacademy.workers.dev/api/auth/instagram/callback |
| 개인정보 처리 안내 | https://jbgolf-connection.jbgolfacademy.workers.dev/privacy |
| 데이터 삭제 안내 | https://jbgolf-connection.jbgolfacademy.workers.dev/data-deletion |

사용 가능한 앱 정보가 확보되면 Cloudflare의 **Workers & Pages → jbgolf-connection → Settings → Variables and Secrets**에서 `INSTAGRAM_APP_ID`를 Text, `INSTAGRAM_APP_SECRET`을 Secret으로 설정합니다. 앱 비밀키는 채팅·GitHub에 보내지 않습니다. 기존 `TOKEN_ENCRYPTION_KEY`와 D1은 보존합니다.

## 전달용 짧은 문장

> 인스타그램 광고 보고 사이트의 무료 서버와 데이터베이스는 준비되었습니다. 실제 계정 연결을 위해 회사에서 사용할 수 있는 Meta 앱과 앱 관리 권한 확인이 필요합니다. 현재 화면에서는 앱 생성이 비활성화되어 있어 관리자 확인을 기다리고 있습니다. 비밀번호 공유 없이 관리자가 직접 확인해주시면 됩니다.

자세한 현재 설정과 남은 범위: [계정 연결 안내](INSTAGRAM_SETUP.md), [무료 서버 배포 기록](CLOUDFLARE_DEPLOYMENT.md).
