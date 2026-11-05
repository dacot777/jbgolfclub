# GitHub Pages 배포 기록

- 공개 주소: https://dacot777.github.io/jbgolfclub/
- 원본 저장소: https://github.com/dacot777/jbgolfclub
- 첫 소스 커밋: `2538f620ef0e70b9387e6f41f7e0f1e8c4701841` (`main`)
- 첫 정적 배포 커밋: `b3acde6425e8b39867075303eac82b2627b81f7e` (`gh-pages`)
- GitHub Pages 실행: https://github.com/dacot777/jbgolfclub/actions/runs/41959889315
- 실행 결과: **Success**, 31초. GitHub 실행 기록이 실제 공개 주소를 표시했습니다.

## 검증 범위

`npm run build:pages`가 생성한 `/jbgolfclub/` 하위 경로를 실제 Chromium에서 확인했습니다. 초기 화면, 예시 데이터 모드, 동적 차트 모듈, 광고 단계 전환 및 자산 요청 오류가 없었습니다. GitHub Pages의 build/deploy 성공을 확인했습니다.

이 Codex 환경에서 공개 도메인으로 보내는 HTTP 요청은 네트워크 정책(프록시 CONNECT 403)으로 차단되어 최종 공개 URL의 HTTP 응답/화면은 직접 검증하지 못했습니다. 이 오류를 사이트의 HTTP 403으로 해석하지 않습니다. 공개 URL은 사용자의 브라우저에서 열 수 있는 GitHub Pages 주소입니다. GitHub가 자동으로 활성화해 별도 Pages 설정 조작은 필요하지 않았습니다.

## 이후 갱신

1. 소스를 수정·검증하고 main에 정상 push합니다.
2. `npm run build:pages`로 정적 결과물을 만듭니다. 일반 `npm run build` 결과는 루트 경로용이므로 Pages에는 사용하지 않습니다.
3. dist 내용과 빈 `.nojekyll`을 gh-pages 브랜치에 게시합니다. 기존 gh-pages 이력을 이어서 커밋하고 force push는 사용하지 않습니다. 현재 gh-pages는 원본 소스와 분리된 정적 결과물 전용 브랜치입니다.
4. Pages 실행이 성공하고 공개 URL이 배포 커밋을 제공하는지 확인합니다.

현재는 프론트엔드 배포입니다. 실제 계정 인증, 데이터베이스, 시간별 수집 서버와 광고 관리자 실적 대조는 별도 구현이 필요합니다. 실제 토큰이나 회사 광고 데이터를 이 정적 배포 브랜치에 넣지 않습니다.

## Instagram 연결 준비 UI

후속 버전은 Instagram 전용 연결 안내와 계정 연결/광고 실적 권한의 구분을 포함합니다. GitHub Pages 빌드에서는 서버 API 요청과 로그인 제출이 활성화되지 않습니다. 실제 로그인 기능은 무료 Workers/D1 서버에 앱 설정과 허용 @아이디를 등록하고 회사 계정 소유자가 승인한 후 별도로 검증해야 합니다. 아직 실제 계정을 연결했다고 취급하지 않습니다.

### @jbgolfacademy 안내 반영 완료

- Source main: `126c5c578ecf7e953e350a370125fdb415447ad3`
- Static gh-pages: `ca14ae71eeb67562ec2151112dcea5ca8ab2fb3c`
- Pages run: https://github.com/dacot777/jbgolfclub/actions/runs/41968714205
- Result: **Success**, 25초.
- 반영 내용: Instagram 전용 연결 준비 UI와 @jbgolfacademy 대상 표시. 실제 OAuth 서버는 아직 미설정이며, 계정 인증·광고 실적 권한이 연결되었다고 표시하지 않습니다.

## 2026-11-05 — Workers Free 연결 서버 배포

연결용 사이트 **https://jbgolf-connection.jbgolfacademy.workers.dev/**를 Workers Free + D1에 배포했습니다. 리소스·버전·현재 설정 상태는 [Cloudflare 배포 기록](CLOUDFLARE_DEPLOYMENT.md)에 있습니다. Instagram 앱 설정과 실제 사용자 승인, 광고 조회 권한은 아직 필요합니다.

새 환경에서는 기존 GitHub Pages 주소도 직접 조회해 HTTP 200, 한국어 페이지 제목, `/jbgolfclub/assets/` 경로를 확인했습니다. 이번 작업에서 기존 `gh-pages` 결과물을 변경하거나 리디렉션하지 않았습니다.
