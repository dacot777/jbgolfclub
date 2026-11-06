# Cloudflare 무료 연결 서버 배포 기록

2026-11-06 최신 상태: 비공개 방문 통계와 로고 위 클릭 동작 수정을 배포했습니다. 소스 `5ee2cd2`, 활성 Worker 버전 `7b499e5e-d385-4e04-bb5f-a27f6a817bbd`. 초기 Workers 관리 API503은 복구됐고 관리자 Secret 설정·마이그레이션0004·공개 주소의 실제 인증/기록 검증까지 완료했습니다. 로고 위 빈 공간을 세 번 눌러 관리자 로그인으로 이동합니다. [상세 검증](DEPLOYMENT.md).

앞선 2026-11-06 업데이트에서는 주간업무보고 메뉴를 제거하고 사용자 지정 첫 기준 기간 10월 29일~11월 6일을 원본과 별도 보관했습니다. 전체 누적/기간 증가분 선택과 후속 분석 코멘트를 지원합니다. 당시 Worker 버전은 `1c742d4e-26f1-43e3-8930-7e16f5755455`, 소스는 `bc106ae`입니다. 방패 로고·광고 사진·기사/블로그 기능을 유지합니다. 아래 표는 최초 배포 시점의 기록이며 최신 검증은 [배포 기록](DEPLOYMENT.md)을 참고하세요. DB·암호화 Secret·무료 플랜·과거 스냅샷은 유지합니다.

확인일: 2026-11-05. Cloudflare API 토큰 인증과 무료 서버 배포는 완료했고, Instagram 앱 등록·사용자 승인·광고 실적 권한은 아직 완료되지 않았습니다.

## 무료 요금제 확인

사용자가 제공한 해당 계정의 Billing → Subscriptions 화면에 **Workers Free · Active**가 표시됐습니다. 확인 후에만 리소스를 생성했습니다. 유료 Workers 전환, 유료 도메인 구매, 결제 수단 등록, 과금 구독 API를 호출하지 않았습니다. 사용량은 [비용 원칙](COST_POLICY.md)의 계정 공통 무료 한도를 적용받습니다.

## 실제 리소스

| 항목 | 값 |
| --- | --- |
| 연결용 사이트 | https://jbgolf-connection.jbgolfacademy.workers.dev/ |
| Cloudflare account ID | `c532af9e92726d2a585e8cfa5e34fb4a` |
| workers.dev subdomain | `jbgolfacademy` |
| Worker 이름 | `jbgolf-connection` |
| D1 이름 | `jbgolf-single-instagram` |
| D1 ID | `2be914cf-7c01-4357-80d3-6c3b775ab76f` |
| 마이그레이션 | `0001_single_instagram.sql` 적용 완료 |
| 코드 배포 버전 | `93b31bdb-9bf0-400b-9d1c-dc3d450b29f9` |
| 암호화 Secret 추가 후 활성 버전 | `a9d62c77-e324-41a5-b598-c68d049a8095` |
| 활성 deployment ID | `83ef7ebb-c068-449e-b9f1-ff8ec5c1f287` |
| 배포한 소스 | `7e33c13d3f3a045665322f0d05163a32d8984501` |

표의 리소스 ID는 비밀키가 아닙니다. 인증 토큰과 암호화 키 값은 이 문서와 저장소에 포함하지 않습니다.

`APP_ORIGIN`, `INSTAGRAM_ACCOUNT_USERNAME=jbgolfacademy`, `INSTAGRAM_API_VERSION=v26.0`, D1·정적 자산 바인딩을 등록했습니다. `TOKEN_ENCRYPTION_KEY`는 Cloudflare의 `secret_text` 바인딩에만 저장했습니다. 운영 설정 파일 `wrangler.production.jsonc`는 Git 제외 파일입니다.

## 실제 검증

- 공식 API의 토큰 검증 결과 `active`, 계정 목록 한 개, Worker/D1 관리 요청 성공.
- D1 마이그레이션 7개 명령 적용, 앱 테이블·인덱스 생성 확인. `instagram_connection` 행 수는 0.
- `GET /`, `/privacy`, `/data-deletion`: HTTP 200.
- `GET /api/connection`: HTTP 200, `configured: false`, `authenticated: false`, `advertisingAccess: false`.
- 같은 출처의 `POST /api/auth/instagram/start`: HTTP 503 JSON `server_not_configured`. 앱 등록 전 로그인을 시작하지 않는 동작을 확인했습니다.
- 실제 공개 주소를 Chromium으로 열어 한국어 제목·본문·데스크톱 화면을 확인했고 페이지 JavaScript 오류는 0개였습니다.
- 서버 빌드와 실제 로컬 Workers/D1 기반 검사 9개 통과. 이 검사의 Instagram 응답은 가짜 응답입니다.
- 기존 GitHub Pages 주소도 HTTP 200으로 응답했습니다. 기존 Pages 배포는 변경하지 않았습니다.

## 현재 스케줄의 범위

등록한 Cron은 `0 0 * * *`(매일 UTC 00:00, 한국 시간 09:00)이며 익명 방문 통계의 오래된 기록·세션·요청 제한 정리와 Instagram 연결 토큰 유지에 사용합니다. 방문 통계 정리는 Instagram 앱 설정과 무관하게 실행합니다. 앱 설정이 없으면 외부 토큰 갱신을 실행하지 않습니다. **매시간 유료 광고 실적을 수집하는 스케줄이 아닙니다.** Marketing API 권한과 실적 수집은 다음 별도 작업입니다.

## 남은 계정 연결 작업

사용자는 관리자 단계에서도 Facebook 계정을 사용하지 않습니다. 현재 확인한 신규 개발자 등록 절차는 Facebook 계정을 요구하므로 그 경로는 진행하지 않습니다. 사용자 화면에서 회사 비즈니스의 ‘추가된 앱 없음’과 ‘새 앱 ID 만들기’ 비활성화를 확인했고, 계정 연결은 **관리자 확인 대기**로 두었습니다. 비활성화의 정확한 원인은 확인되지 않았습니다. 아래 작업은 실제로 사용할 수 있는 앱 정보와 권한이 확보된 경우에만 진행합니다. [관리자 전달 메모](META_ACCOUNT_HANDOFF.md)를 참고하세요.

1. Meta 개발자 앱에 **Instagram API with Instagram Login**을 설정합니다.
2. 실제 [앱 설정 주소](INSTAGRAM_SETUP.md#현재-준비된-서버와-다음-입력값)와 callback URI를 등록합니다.
3. Worker의 `INSTAGRAM_APP_ID`(Text), `INSTAGRAM_APP_SECRET`(Secret)을 입력합니다. 비밀키는 채팅에 보내지 않습니다.
4. 회사 계정의 프로페셔널 계정 조건·테스터 승인 여부를 확인하고 실제 사이트에서 공식 Instagram 로그인을 완료합니다.
5. 광고 실적 권한을 별도로 연결하고 API 값과 광고 관리자 값을 대조합니다.

재배포 시 기존 D1과 `TOKEN_ENCRYPTION_KEY`를 보존합니다. Cloudflare 대시보드에서 앱 ID를 추가한 경우, 이후 배포가 그 값을 삭제하지 않도록 공개 앱 ID를 로컬 운영 vars와 동기화합니다.
