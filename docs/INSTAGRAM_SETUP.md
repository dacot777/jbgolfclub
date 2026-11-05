# 인스타그램 계정 한 개 연결 준비

## 이번 단계의 범위

연결 대상으로 지정된 계정: **[@jbgolfacademy](https://www.instagram.com/jbgolfacademy/)**. 사용자가 제공한 공개 계정 주소이며 실제 로그인 승인은 아직 완료되지 않았습니다. 배포한 서버의 허용 계정에 이 이름을 반영했습니다.

사용자는 인스타그램 공식 로그인으로만 로그인합니다. 로그인 주소는 `www.instagram.com/oauth/authorize`이며 `enable_fb_login=0`을 지정합니다. 요청 권한은 `instagram_business_basic` 하나입니다. 인스타그램 비밀번호나 인증번호를 이 사이트·GitHub·채팅에 입력하지 않습니다.

이 권한은 인스타그램 계정 식별을 위한 권한입니다. **광고비·캠페인별 유료 광고 실적 조회 권한을 부여하지 않습니다.** 광고 실적을 가져오려면 회사 광고 계정의 Marketing API 읽기 권한이 별도로 필요합니다. 인스타그램 로그인 성공을 광고 실적 연동 성공으로 취급하지 않습니다. 광고 집행 방식과 권한 보유 담당자를 확인한 뒤 광고 연결 단계를 정합니다.

한 계정의 `@아이디`를 서버 설정에 고정합니다. 공식 로그인 결과의 이름을 확인하고, 처음 연결한 계정 ID를 저장한 뒤 다른 ID로 바꾸지 않습니다. 여러 계정 추가 기능은 구현하지 않습니다.

## 현재 준비된 서버와 다음 입력값

2026-11-05 Workers Free + D1 서버를 실제 배포했습니다. 운영 주소는 **https://jbgolf-connection.jbgolfacademy.workers.dev**입니다. 데이터베이스 테이블과 `TOKEN_ENCRYPTION_KEY` Secret을 생성했고, 홈페이지와 연결 상태 API의 실제 응답을 확인했습니다. 앱 설정 전에는 API가 `configured: false`를 반환합니다.

현재 상태는 **관리자 확인 대기**입니다. 사용자 화면에서 회사 비즈니스의 ‘추가된 앱 없음’과 ‘새 앱 ID 만들기’ 비활성화를 확인했습니다. 비활성화의 정확한 원인은 확인되지 않았습니다. 같은 메뉴나 앱 생성 링크를 반복 안내하지 않습니다. 현재 사용자에게 앱 정보·인증번호·다른 사람의 비밀번호를 요청하지 않습니다. [관리자 전달 메모](META_ACCOUNT_HANDOFF.md)에 완료 항목과 필요한 확인사항을 정리했습니다.

| 앱 설정 항목 | 실제 입력 주소 |
| --- | --- |
| 사이트 주소 | https://jbgolf-connection.jbgolfacademy.workers.dev/ |
| OAuth Redirect URI | https://jbgolf-connection.jbgolfacademy.workers.dev/api/auth/instagram/callback |
| 개인정보 처리 안내 | https://jbgolf-connection.jbgolfacademy.workers.dev/privacy |
| 데이터 삭제 안내 | https://jbgolf-connection.jbgolfacademy.workers.dev/data-deletion |
| 데이터 삭제 콜백 | https://jbgolf-connection.jbgolfacademy.workers.dev/api/data-deletion |
| 연결 해제 콜백 | https://jbgolf-connection.jbgolfacademy.workers.dev/api/auth/instagram/deauthorize |

앱 정보를 받으면 Cloudflare의 **Workers & Pages → jbgolf-connection → Settings → Variables and Secrets**에서 아래 항목을 추가하고 Deploy합니다.

- `INSTAGRAM_APP_ID`: **Text** 유형의 공개 앱 ID.
- `INSTAGRAM_APP_SECRET`: **Secret** 유형의 앱 비밀키. 채팅이나 GitHub에 보내지 않습니다.

`APP_ORIGIN`, 허용 계정, API 버전, D1 연결, 암호화 키는 이미 등록되어 있습니다. 암호화 키를 새로 만들거나 기존 데이터베이스를 삭제하지 않습니다. 대시보드에서 앱 ID를 설정했다면 이후 Wrangler 배포 전에 그 공개 값을 로컬 운영 설정에도 반영해 보존해야 합니다.

앱의 테스트 계정 등록·초대 승인과 프로페셔널 계정 조건은 실제 Instagram 제품 화면에서 확인합니다. 준비 후 사이트의 공식 Instagram 로그인에서 회사 계정 소유자가 승인합니다. 관리자용 개발자 앱 등록과 사이트 이용자의 Instagram 로그인은 별도 절차입니다.

## 사용자가 확인할 공개 정보

1. 연결할 인스타그램 `@아이디`: **jbgolfacademy** (사용자 지정 완료).
2. 비즈니스 또는 크리에이터 등 프로페셔널 계정인지 여부.
3. 광고가 인스타그램 앱 ‘게시물 홍보하기’, Meta 광고 관리자, 대행사 중 어디에서 집행되는지.

이 정보에는 비밀키가 포함되지 않습니다.

## 앱 등록과 사이트 로그인

2026-11-05 확인한 [Meta 공식 개발자 등록 안내](https://developers.facebook.com/documentation/development/register)의 첫 단계는 **Facebook 계정으로 로그인한 상태에서 개발자 등록을 시작**하는 것입니다. 원문은 “While logged into your Facebook account”라고 안내합니다. 인스타그램 아이디로 Meta Business Suite에 로그인한 상태만으로 개발자 등록이 완료됐다고 판단하지 않습니다.

사용자는 **관리자 등록 단계에서도 Facebook 계정을 사용하지 않음**을 명시했습니다. 따라서 위의 신규 개발자 등록 경로는 진행하지 않습니다. 현재 Instagram/Meta 로그인으로 접근할 수 있는 회사 비즈니스에 이미 소유한 앱이 있는지 확인할 수는 있으나, 실제 앱 정보·Instagram Login 설정·조회 권한을 확보하기 전까지 해당 경로가 작동한다고 주장하지 않습니다. 사이트 이용자의 로그인은 Instagram 공식 로그인으로 유지합니다.

회사 기존 앱이 없다면 현재 확인한 공식 신규 등록 절차를 사용자의 조건으로 완료할 수 없습니다. 이 경우 매시간 광고 수집이 가능하다고 안내하거나, 사용자 선택 없이 수동 CSV 가져오기 방식으로 요구사항을 바꾸지 않습니다. Facebook 로그인·신규 가입·다른 담당자의 Facebook 사용을 다시 요청하지 않습니다.

인스타그램 공식 로그인을 제공하려면 회사의 Meta 앱에 **Instagram API with Instagram Login**을 설정해야 합니다. 개발자 앱을 만드는 관리 절차와 사용자가 사이트에서 하는 인스타그램 로그인은 별개입니다. 사이트 이용자에게 Facebook 로그인을 요구하는 구현을 넣지 않았습니다. 이미 발급되어 안전하게 보관한 회사 앱 정보가 있다면 현재 조건으로 설정할 수 있는지 확인합니다.

예전 Instagram Basic Display나 Facebook Login으로 임의 대체하지 않습니다. 회사 계정 한 개를 시험하려면 앱의 해당 인스타그램 테스트 계정 등록 및 초대 승인이 필요한지 앱 설정에서 확인합니다. 타 회사 계정에 제공할 때의 앱 검토 범위는 이번 한 계정 작업에 포함하지 않습니다.

필요한 값:

- `INSTAGRAM_APP_ID`: Instagram 로그인 제품 설정에서 표시되는 앱 ID. 일반 Facebook 앱 ID를 잘못 넣지 않습니다.
- `INSTAGRAM_APP_SECRET`: 같은 Instagram 앱의 비밀키. Cloudflare의 Secret 입력란에만 넣습니다.
- `INSTAGRAM_ACCOUNT_USERNAME`: 회사 인스타그램 @아이디(앞의 @는 있어도 됨).
- `APP_ORIGIN`: 실제 연결 서버의 HTTPS 주소, 끝의 `/` 제외.
- `TOKEN_ENCRYPTION_KEY`: 서버에 저장할 무작위 32바이트 암호화 키의 base64 값. 서버 설정 단계에서 생성해 Secret으로 저장합니다. 채팅이나 GitHub에 남기지 않습니다.

## 무료 서버 구성

현재 GitHub Pages는 정적 화면이므로 토큰·비밀키를 보관할 수 없습니다. Cloudflare Workers Free + D1 무료 구성을 준비했습니다. 로그인 쿠키와 API가 같은 출처에서 동작하도록 실제 계정 연결용 홈페이지와 API를 Workers 한 주소에서 제공합니다. 별도 유료 도메인은 필요하지 않습니다.

Cloudflare 계정 인증과 무료 요금제 확인, 실제 서버 배포는 완료했습니다. Instagram 앱 ID·비밀키와 계정 소유자의 실제 로그인 승인은 아직 필요합니다. 비밀번호·비밀키를 채팅으로 전달하지 않습니다.

처음 준비하는 사용자는 [무료 서버 1회 준비 안내](CLOUDFLARE_FREE_SETUP.md)를 먼저 따릅니다. 실제 토큰 값이 없는 상태에서 배포 권한이 있다고 가정하지 않습니다.

최초 배포 절차(운영자용, 현재 서버는 생성 완료):

1. Cloudflare에서 Workers 플랜이 Free인지 확인합니다.
2. `wrangler.example.jsonc`를 로컬의 `wrangler.production.jsonc`로 복사하고 실제 Workers 주소·Instagram 앱 ID·@아이디를 설정합니다. 예제의 `YOUR_...`와 D1 ID는 플레이스홀더이며 실제 인증정보가 아닙니다.
3. `npx wrangler d1 create jbgolf-single-instagram`으로 D1을 만들고 반환된 실제 ID를 설정합니다.
4. `npx wrangler d1 migrations apply jbgolf-single-instagram --remote --config wrangler.production.jsonc`로 테이블을 생성합니다.
5. `npx wrangler secret put INSTAGRAM_APP_SECRET --config wrangler.production.jsonc` 및 `TOKEN_ENCRYPTION_KEY`를 Secret으로 입력합니다. 토큰이나 키를 소스의 vars에 넣지 않습니다.
6. `npm run deploy:worker`로 같은 주소의 홈페이지와 API를 배포합니다.
7. Instagram 앱의 OAuth Redirect URI를 `https://실제주소/api/auth/instagram/callback`으로 등록합니다. 개인정보 안내는 `/privacy`, 삭제 안내는 `/data-deletion`, 삭제 콜백은 `/api/data-deletion`, 연결 해제 알림 콜백은 `/api/auth/instagram/deauthorize`입니다.
8. 실제 사이트에서 ‘인스타그램으로 로그인하여 연결’을 누르고 해당 계정으로 승인합니다.

## 서버에 구현한 보호와 유지

- 만료 10분의 일회용 OAuth state, HTTP-only/Secure/SameSite 쿠키, 서버 세션과 CSRF 확인.
- 토큰은 D1에 AES-GCM으로 암호화해 저장하고 브라우저 저장소나 API 응답에 보내지 않습니다.
- 계정 삭제·연결 해제 시 연결 토큰과 세션을 제거합니다. Meta의 삭제 알림은 앱 비밀키 서명을 검증합니다.
- 유효한 장기 토큰은 만료 14일 전부터 하루 한 번 확인합니다. 이전 갱신 후 24시간이 지나야 갱신하고, 동시 실행에는 잠금을 사용합니다. 실패 시 기존 토큰을 보존합니다. 이미 만료되거나 권한이 취소되면 다시 인스타그램으로 로그인해야 합니다.
- 이 스케줄은 인스타그램 연결 유지용입니다. 시간별 유료 광고 실적 수집을 구현했다고 주장하지 않습니다.

## 검증과 남은 단계

로컬 Workers/D1 런타임에서 가짜 Instagram API 응답을 사용하는 9개 검사가 통과했습니다. 실제 배포 서버의 홈페이지·연결 상태 API·테이블·암호화 Secret·스케줄도 확인했습니다. 이 검증은 실제 Meta 앱의 승인이나 실제 Instagram 로그인 성공의 증거가 아닙니다. 앱 설정과 사용자 승인 후 실제 계정으로 다시 검증해야 합니다.

공식 참고: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/ · https://developers.facebook.com/docs/marketing-api/get-started/authorization/ · https://developers.cloudflare.com/workers/static-assets/
