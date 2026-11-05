# 무료 연결 서버를 위한 1회 준비

연결 대상은 `@jbgolfacademy`입니다. 코드 수정과 배포는 Codex가 진행합니다. 서버 관리 계정의 생성·본인 인증·권한 발급은 계정 소유자가 직접 해야 합니다.

## 1. Cloudflare 무료 계정 준비

https://dash.cloudflare.com/sign-up 에서 무료 계정을 만들거나 기존 계정으로 로그인합니다. Workers는 **Free** 플랜을 사용합니다. 도메인을 구매하거나 유료 Workers 플랜을 선택하지 않습니다.

## 2. 이 프로젝트를 관리할 API 토큰 만들기

https://dash.cloudflare.com/profile/api-tokens 에서 API 토큰 생성을 선택합니다. Custom Token에서 다음 계정 권한을 포함합니다.

- Account → Workers Scripts → Edit
- Account → D1 → Edit
- Account → Account Settings → Read

Account Resources는 서버를 만들 본인의 Cloudflare 계정으로 제한합니다. 임의의 전역 API 키나 계정 비밀번호를 전달하지 않습니다. 기본 Workers 편집 템플릿을 쓰는 경우에도 D1 편집 권한이 포함되는지 확인합니다.

## 3. 토큰을 채팅 대신 환경 설정에 등록

이 채팅의 클라우드 환경 설정에 `CLOUDFLARE_API_TOKEN` 비밀값 요구 항목을 준비했습니다. 생성한 토큰은 해당 항목에 입력하고 저장·적용합니다. 환경 편집기가 게시를 요구하면 환경을 게시합니다. 토큰을 채팅, GitHub 파일, 프론트엔드 설정에 붙여넣지 않습니다.

이 바인딩은 `api.cloudflare.com`의 HTTPS 요청에만 사용합니다. 값을 안전하게 등록한 후에는 Codex가 기존 인증을 이용해 계정을 조회하고, 무료 Workers/D1 생성·배포·암호화 키 설정을 진행할 수 있습니다. 여러 계정이 나오면 임의로 다른 회사 계정을 선택하지 않습니다.

## 그다음 단계

2026-11-05 위 준비를 완료하고 **https://jbgolf-connection.jbgolfacademy.workers.dev/**에 Workers Free + D1 서버를 배포했습니다. 다음 작업은 [Instagram 앱 설정](INSTAGRAM_SETUP.md#현재-준비된-서버와-다음-입력값)입니다. [배포 기록](CLOUDFLARE_DEPLOYMENT.md)에 실제 생성한 리소스와 검증 결과를 남겼습니다.

무료 연결 서버의 실제 HTTPS 주소를 만든 뒤 Instagram 앱의 로그인 URL을 설정합니다. 사이트의 로그인은 Instagram 공식 로그인만 사용합니다. Meta 개발자 앱에 Instagram 로그인 제품을 등록하는 관리 절차와 회사 계정의 승인 자체는 별도로 필요합니다.

`@jbgolfacademy`라는 주소를 등록한 것만으로 로그인이 승인되거나 광고비 조회 권한이 생기지는 않습니다. Instagram 기본 계정 연결과 유료 광고 실적 권한을 구분한 상태로 진행합니다. Instagram 앱 비밀키도 채팅에 보내지 않고 이후 지정하는 서버 Secret 입력란에 저장합니다.
