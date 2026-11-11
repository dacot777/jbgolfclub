# Cloudflare 무료 연결 서버 배포 기록

2026년 11월 11일 기존 Workers Free와 D1에 [Instagram 광고 수집](META_ADS_REPORT.md)을 배포했습니다. Worker 버전 `f5bc5fbb-0cfa-4ee9-9818-164a3e5dad3b`에서는 메인 화면의 별도 보고서 영역에서 첫 실적을 확인했습니다. 운영 D1에 `0005_meta_ads.sql`을 적용했고, Worker에 `META_ADS_ACCESS_TOKEN`을 Secret으로 저장하고 두 예약 작업을 등록했습니다. 서버에서 예약 작업과 같은 수집 함수를 실행해 첫 데이터를 채웠습니다. 당시 로그인하지 않은 데스크톱·모바일에서 공개 보고서를 확인했고 방문 통계 API는 인증을 요구했습니다. 광고 관리자와 같은 조건으로 수치를 대조하는 작업은 남아 있습니다.

2026년 11월 6일에는 비공개 방문 통계와 로고 위 클릭 동작 수정을 배포했습니다. 당시 소스는 `5ee2cd2`, Worker 버전은 `7b499e5e-d385-4e04-bb5f-a27f6a817bbd`입니다. 초기 Workers 관리 API503은 복구됐고 관리자 Secret 설정·마이그레이션0004·공개 주소의 실제 인증/기록 검증까지 완료했습니다. 로고 위 빈 공간을 세 번 눌러 관리자 로그인으로 이동합니다. [상세 검증](DEPLOYMENT.md).

앞선 2026-11-06 업데이트에서는 주간업무보고 메뉴를 제거하고 사용자 지정 첫 기준 기간 10월 29일~11월 6일을 원본과 별도 보관했습니다. 전체 누적/기간 증가분 선택과 후속 분석 코멘트를 지원합니다. 당시 Worker 버전은 `1c742d4e-26f1-43e3-8930-7e16f5755455`, 소스는 `bc106ae`입니다. 방패 로고·광고 사진·기사/블로그 기능을 유지합니다. 아래 표는 최초 배포 시점의 기록이며 최신 검증은 [배포 기록](DEPLOYMENT.md)을 참고하세요. DB·암호화 Secret·무료 플랜·과거 스냅샷은 유지합니다.

2026년 11월 5일 최초 배포 시점에는 Cloudflare API 토큰 인증과 무료 서버 배포를 확인했습니다. 당시 Instagram 프로필 로그인과 광고 실적 권한은 준비 전이었습니다.

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

## 최초 배포 검증 (2026년 11월 5일)

- 공식 API의 토큰 검증 결과 `active`, 계정 목록 한 개, Worker/D1 관리 요청 성공.
- D1 마이그레이션 7개 명령 적용, 앱 테이블·인덱스 생성 확인. `instagram_connection` 행 수는 0.
- `GET /`, `/privacy`, `/data-deletion`: HTTP 200.
- `GET /api/connection`: HTTP 200, `configured: false`, `authenticated: false`, `advertisingAccess: false`.
- 같은 출처의 `POST /api/auth/instagram/start`: HTTP 503 JSON `server_not_configured`. 앱 등록 전 로그인을 시작하지 않는 동작을 확인했습니다.
- 실제 공개 주소를 Chromium으로 열어 한국어 제목·본문·데스크톱 화면을 확인했고 페이지 JavaScript 오류는 0개였습니다.
- 서버 빌드와 실제 로컬 Workers/D1 기반 검사 9개 통과. 이 검사의 Instagram 응답은 가짜 응답입니다.
- 기존 GitHub Pages 주소도 HTTP 200으로 응답했습니다. 기존 Pages 배포는 변경하지 않았습니다.

## 광고 상세 카드 배포 검증

2026년 11월 11일 기존 운영 Worker에 광고별 상세 카드를 배포했습니다. 운영 버전은 `c184241c-4e7e-4f77-bb22-3ab97b4b1368`입니다. 기존 D1에 0006·0007을 적용하고 Meta로 초기 수집을 완료했습니다. 일반 공개 주소에서 데스크톱과 모바일 너비로 누적 기본값, 썸네일, 시작·중단 일시, 첫 집행 주부터의 주간 조회, 일일 선택 제거를 확인했습니다. 같은 기간의 전지훈련 링크 클릭과 클릭당 비용을 광고 관리자 캡처와 대조했습니다.

광고 카드용 스키마는 `0006_meta_ad_registry.sql`과 `0007_meta_ad_lifetime.sql`입니다. 기존 Worker와 D1에서 추가 마이그레이션을 적용하고 광고별 누적 조회와 주간·월간 이력을 검증합니다. 메인 화면의 광고 카드, 이전 상세 링크, 중단 이력과 실제 썸네일은 공개 브라우저로 확인합니다. [광고별 수집·검증 기준](META_ADS_REPORT.md)

## 예약 수집과 누적 조회

- `15 * * * *` — 매시 15분에 Marketing API에서 Instagram 게재 광고 실적을 조회해 기존 D1의 광고 보고서 테이블에 저장합니다.
- `GET /api/meta-ads/lifetime` — 메인 화면이 보이는 동안 60초 간격으로 조회합니다. 계정 단위 캐시와 잠금이 여러 방문자의 요청을 공유합니다. 광고별 상태, 시작·중단 기록, 주간·월간 값은 시간별 수집 결과를 사용합니다.
- `0 0 * * *` — 매일 UTC 00:00(한국 시간 09:00)에 오래된 방문 통계·세션·요청 제한 기록을 정리합니다. Instagram 프로필 연결이 설정된 경우 해당 토큰도 유지합니다.

## Instagram 프로필 로그인 설정

11월 5일 Business Suite에서 개발자 등록을 진행할 때의 기록은 [관리자 전달 메모](META_ACCOUNT_HANDOFF.md)에 있습니다. 11월 11일 회사 관리자는 광고 보고용 Meta 앱을 준비해 읽기 전용 서버 토큰을 발급했습니다. 사이트의 Instagram 프로필 로그인에는 아래 설정과 계정 소유자의 승인이 필요합니다.

1. Meta 개발자 앱에 **Instagram API with Instagram Login**을 설정합니다.
2. 실제 [앱 설정 주소](INSTAGRAM_SETUP.md#현재-준비된-서버와-다음-입력값)와 callback URI를 등록합니다.
3. Worker의 `INSTAGRAM_APP_ID`(Text), `INSTAGRAM_APP_SECRET`(Secret)을 입력합니다. 비밀키는 채팅에 보내지 않습니다.
4. 회사 계정의 프로페셔널 계정 조건·테스터 승인 여부를 확인하고 실제 사이트에서 공식 Instagram 로그인을 완료합니다.

재배포 시 기존 D1과 `TOKEN_ENCRYPTION_KEY`를 보존합니다. Cloudflare 대시보드에서 앱 ID를 추가한 경우, 이후 배포가 그 값을 삭제하지 않도록 공개 앱 ID를 로컬 운영 vars와 동기화합니다.
