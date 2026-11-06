# 도구·스킬 검토 및 적용 기록

## 2026-11-06 — 채팅 캡처를 기존 성과 대시보드에 반영

- 사용자 의도 교정: 캡처를 채팅으로 전달하면 assistant가 정확하게 전사·확인해 기존 대시보드 숫자·게시물 링크를 갱신합니다. 업로드/수동 입력 페이지를 복원하지 않습니다.
- 도구·범위: 기존 Cloudflare Workers/D1와 Wrangler 4.157.0(MIT OR Apache-2.0), React/shadcn/Radix/Lucide/Playwright를 재사용. 출처 https://github.com/cloudflare/workers-sdk · https://developers.cloudflare.com/d1/. 추가 설치·계정·API 키·유료 기능 없음.
- 버전·절차: D1 마이그레이션 `0002_reviewed_performance.sql`, 공유 응답 계약 version 1 / reviewed_screenshots. Git 제외 비공개 자료를 서버 validator로 검사하고 기존 D1에 바인딩한 쿼리로 반영. 실제 회사 수치는 공개 소스/자산/테스트에 넣지 않습니다. 기존 DB와 Secret·환경 변수는 유지합니다.
- UI/UX Pro Max 기존 설치에서 `empty state missing data --domain ux` 검색. 첫 결과 Feedback/Empty States의 빈 자료 안내가 적합해 적용했고 관련 없는 Bulk Actions 결과는 적용하지 않았습니다. 기존 디자인 토큰·한글 라벨·키보드 조작과 모바일 화면을 유지합니다.
- 원문 수치·목표별 비용 교차 확인, 집계 날짜 미확인 처리, 동일 기간 최신본 선택, 0/누락 구분, 결과 종류 분리, 고유 인원 합산 금지를 적용했습니다. 검토·운영 기준: [캡처 확인 자료](REVIEWED_PERFORMANCE.md).
- 검증: 프론트엔드·Worker 빌드, 기존 화면/연결 및 새 기간별 조회/원문 지표/영속 조회/실패 재시도를 포함한 브라우저·계산 검사 23개, 실제 로컬 Worker/D1 14개 통과. 최종 화면 조정 후 새 브라우저 7개도 다시 통과했습니다. 375/768/1440px 넘침 없음, 임의 일별 자료 생성 없음, 실제 자료가 번들에 포함되지 않음을 확인했습니다.

## 2026-11-06 — 사용자 요청으로 인사이트 기록 제거

인사이트 기록 메뉴·페이지·진입 배너·입력/백업 구현과 전용 검사를 제거했습니다. 기존 `#records` 주소는 성과 대시보드로 이동합니다. 과거 브라우저 저장 자료는 삭제하지 않습니다. 새 패키지·외부 서비스·유료 기능은 도입하지 않으며, 아래의 수동 기록 도입 내역은 이전 작업의 기록입니다.

프론트엔드·Worker 빌드와 기존 브라우저 10개 검사가 통과했고 실제 배포 후 이전 링크의 대시보드 이동, 메뉴 제거, 모바일/예시 화면을 확인했습니다. 버전과 배포 범위는 [배포 기록](DEPLOYMENT.md)에 남겼습니다.

## 2026-11-06 — 캡처 기반 인사이트 기록

- 이름·종류: IndexedDB / FileReader / Blob, 브라우저 기본 Web API. 목적: 회사 광고 캡처·수치를 현재 브라우저에 보관하고 JSON 백업/복원. 출처: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API · https://developer.mozilla.org/en-US/docs/Web/API/FileReader.
- 버전·설치 범위: IndexedDB DB 스키마 1, 백업 포맷 `jbgolf-insights` v1. 현재 사이트 origin의 브라우저 저장소만 사용. 추가 패키지·설치 스크립트·전역 설정 변경 없음. 별도 배포 라이선스가 있는 제3자 코드를 복사하지 않았으며 사용 브라우저 구현의 조건을 따릅니다.
- 인증·비용: 별도 인증·API 키·유료 기능 없음. 회사 광고 자료를 서버·D1·공개 번들에 저장하지 않음. 이미 설치한 React/shadcn/Radix/Lucide/Vite/Playwright를 재사용.
- UI/UX Pro Max의 기존 설치를 재사용해 `error summary validation --domain ux` 검색을 실행. Forms/Accessibility의 포커스 가능한 오류 요약 및 읽기 가능한 오류 안내가 일치해 적용. 기존 디자인 토큰·한국어 입력 라벨·모바일 레이아웃 유지.
- 인식·검증: Chromium의 실제 IndexedDB 저장·다시 읽기, 첨부 이미지 유지, 수정·보고 복사·삭제·JSON 백업 복원, 덮어쓰기 취소, 실패 상태, 375/768/1440px 확인을 포함해 전체 Playwright 18개 통과. 반올림·기간 미확인·결과 종류 분리·동일 기간 후속 캡처 중복 제외도 검증.
- 도입 이유: 사용자가 지금은 광고 인사이트 캡처로 과거 기록을 남기고 자동 연결은 나중에 진행하도록 선택함. 외부 OCR/AI API와 새로운 서버 데이터 저장은 도입하지 않음. 사용법과 한계: [수동 기록 안내](MANUAL_INSIGHTS.md).
- Worker 타입·프론트엔드 빌드와 기존 로컬 Worker/D1 9개 검사도 통과했습니다. 기존 Wrangler를 재사용해 실제 무료 Worker에 배포하고 HTTPS 브라우저의 가져오기·영속 저장·모바일·서버 비전송을 확인했습니다. 버전·검증 범위는 [배포 기록](DEPLOYMENT.md)에 남겼습니다.

확인일: 2026-11-05. 아래 검토는 사용자 제공 목록과 별도로 실제 원문 조회 결과를 기록합니다. 설치, 원문을 읽고 적용, 참고, 보류를 구분합니다.

## 연결 및 저장소 확인

- 원격 main: `4df41cd466f3ca385f1b8a3baed767f3d9317956`. 사용자 첫 커밋 내용 확인 완료.
- 이전 “proxy:8080 연결 실패”의 재현 시 기본 셸은 소켓을 `Operation not permitted`로 차단했습니다. 기존 프록시/인증을 유지한 승인 실행으로 Git 조회와 다운로드가 성공했습니다. GitHub 허용 목록·토큰을 바꾸지 않았습니다.

## 실제 적용한 스킬

| 이름 | 원문/버전 | 라이선스·범위 | 적용 및 검증 |
| --- | --- | --- | --- |
| UI/UX Pro Max | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill · source `ccce51cba388476d4f403091ddb91636d5cd9fed` · npm CLI `2.15.0` | MIT, 외부 커뮤니티 프로젝트. OpenAI 공식 스킬 아님. `.agents/skills/ui-ux-pro-max/` 프로젝트 범위 | README·SKILL 지침 읽음. 설치된 search.py의 UX·shadcn 검색 실행 성공. 현재 세션 자동 스킬 목록은 새로 고쳐지지 않아 자동 활성화는 확인되지 않음; 이번 작업은 직접 읽어 실행/적용. |
| Vibe UX frontend-ui-engineering | https://github.com/tendtoyj/vibe-ux-skills · `7b66eed92dfd7333f81fa4df90e558980002e595` | 저장소 MIT. 임시 checkout에서 읽음; 전체 plugin 미설치 | 공통 토큰·합성 컴포넌트·데이터/표현 분리·실제 상태 문구에 적용. design-brandfit은 외부 DESIGN 변환용이라 이번 작업에 사용하지 않음. |
| frontend-design | https://github.com/bear2u/my-skills · `8ed57847845fe88e9a4df445659b30b5a414fa09` | README에 MIT라고 명시; 해당 skill의 별도 LICENSE.txt는 확인하지 못함. 원문 지침만 읽음 | 골프 브랜드의 차분한 시각 방향과 타이포 위계에 참고. 스킬 전체를 재배포하거나 plugin 설치하지 않음. |

### UI/UX 설치 절차 및 결과

공식 README의 npm 패키지 이름을 따랐습니다. 소스 package.json의 2.5.0은 레지스트리에 없어 사용하지 않았고, npm에서 확인한 2.15.0을 고정했습니다. 배포본은 README와 달리 --dry-run을 지원하지 않아 help 확인 뒤 실행했습니다. 전역 변경·force 덮어쓰기·유료 자산 사용 없음. CLI가 함께 생성한 미사용 보조 스킬 6개는 이번 실행에서 생성된 것만 제거했습니다.

```bash
npm exec --yes --cache /tmp/jbgolf-npm-cache --package ui-ux-pro-max-cli@2.15.0 -- uipro init --ai codex --offline
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "keyboard focus modal" --domain ux -n 1
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "dashboard components" --stack shadcn -n 1
```

설치된 npm 패키지의 무결성은 npm 검증과 lockfile을 유지했습니다. GitHub 원문의 디자인 시스템 검색은 Data-Dense Dashboard와 Line Chart 지침이 제품에 적합했고, Enterprise Gateway 패턴은 좁힌 검색에서도 부적합해 적용하지 않았습니다. `docs/DESIGN.md`는 검증한 부분과 기존 골프 색상을 합성한 프로젝트 문서입니다.

## 사용자 목록 전체 검토

| 리소스·종류 | 확인한 출처와 커밋 | 라이선스 | 결정·적용 위치 |
| --- | --- | --- | --- |
| 21st-dev/magic-mcp · MCP | https://github.com/21st-dev/magic-mcp · `6b5299e8a83ceffa73d4fc4e148905bb3eeeeb55` | ISC | README의 21st MCP 전환 확인. 구형 proxy 설치 안 함. 현재 공식 설정 사이트 접근 제한, 인증·비용 미확인으로 연결 보류. |
| Eldergenix/awesome-codex-app-template · 앱 운영 템플릿 | https://github.com/Eldergenix/awesome-codex-app-template · `3ba4166929cc977dbf69b89d310eee2e43a800d0` | MIT | 현재 README는 Enterprise Monorepo Template 안내. 디자인 토큰과 검증 문서 분리 참고. 전체 모노레포·추가 인증 도구 미도입. |
| anomalyco/opencode · 별도 코딩 에이전트 | https://github.com/anomalyco/opencode · `6b4fdc28edd30f50d6b3c5e793413d8cee180221` | MIT | README·MIT 확인. 사용자 표의 제외 기준에 따라 Codex 필수 설치에 넣지 않음. |
| magicuidesign/magicui · UI 컴포넌트 | https://github.com/magicuidesign/magicui · `37ce829f18dd7d0a7219531a4249b664419933ea` | MIT | 실제 Number Ticker 소스 채택. 한국어 숫자·모션 줄이기·스크린리더 최종값을 추가. 다른 효과·Pro 자산은 사용 안 함. |
| nolly-studio/cult-ui · UI 컴포넌트 | https://github.com/nolly-studio/cult-ui · `d71b1428b811c2779d46ea41b7ef8c9f9c9991c2` | MIT | README·MIT·Tailwind 4/shadcn/Motion 호환 확인. 이번 보고 화면에서 필요한 동작은 기본 Tabs/Dialog로 충족하여 Cult 소스는 도입하지 않음. |
| satnaing/shadcn-admin · 대시보드 예제 | https://github.com/satnaing/shadcn-admin · `e16c87f213a5ba5e45964e9b67c792105ec74d26` | MIT | 반응형 대시보드·사이드바·검색/필터 배치 참고. 앱의 인증·라우터·전체 예제는 이식하지 않음. |
| shadcn-ui/ui · 기본 UI | https://github.com/shadcn-ui/ui · `8a3536678a528cc012b9e62484290e79d0be410f` | MIT | 실제 Button/Card/Badge/Dialog/Tabs 소스 채택, import 경로와 JB Golf 토큰에 맞춰 수정. 라이선스 보존. |
| tremorlabs/tremor · 차트/대시보드 | https://github.com/tremorlabs/tremor · `ca4d588f47820ff3d514d37fa4ee08a4222dec11` | Apache-2.0 | React/Tailwind/Radix와 Apache 2.0 확인. 차트 대안으로 검토, 동일 역할은 Recharts 하나로 구현해 중복 패키지 미도입. |
| xklob/codex-repo-template · 프로젝트 운영 템플릿 | https://github.com/xklob/codex-repo-template · `e49fc2314ff3fb35a3e758f70f92236722699f0d` | 파일 미확인 — 소스 미복사 | README/설계/구조/계획을 구분하는 문서 체계 참고. 원본 규칙·설정·코드는 복사하지 않음. 라이선스 파일 미확인. |
| 21st.dev 공식 설정 · 서비스/MCP | https://21st.dev/mcp | 현재 이용 조건 미확인 | 프록시가 사이트 접속을 403으로 거부. GitHub의 전환 안내만 확인. API 키·구독을 요청하거나 연결하지 않음. |
| Aceternity UI · 컴포넌트 | https://ui.aceternity.com/ | 무료/유료 항목별 조건 미확인 | 공식 사이트 접속 403. 전달된 미확인 GitHub 경로 대신 공식 사이트 기준을 유지. 소스·유료 블록 미사용. |
| Cult 공식 문서 | https://www.cult-ui.com/docs | GitHub MIT 확인, 웹 문서 미확인 | 사이트는 403. 공식 링크와 설치/호환 안내는 검증된 GitHub README에서 확인. |
| v0 · 별도 UI 서비스 | https://v0.app/ | 계정·기능별 비용 미확인 | 사이트 403. 사용자 표 기준 필수 도구에서 제외, 외부 계정 연결·유료 사용 없음. |

## 실제 사용한 코드와 의존성

- shadcn 소스: `apps/v4/registry/new-york-v4/ui/{button,card,badge,dialog,tabs}.tsx`, 위 표의 고정 커밋. 로컬 `src/components/ui/`로 옮기고 경로·테마를 조정했습니다.
- Magic UI 소스: `apps/www/registry/magicui/number-ticker.tsx`, 위 표의 고정 커밋. `src/components/number-ticker.tsx`에 접근성/한국어/모션 설정을 추가했습니다.
- 두 소스의 MIT 전문과 로컬 폰트 라이선스는 `docs/licenses/`에 있습니다.
- 문서 템플릿의 계정 연결·MCP 설정·AGENTS 규칙은 복사하지 않았습니다.

라이브러리 버전은 아래와 같으며 재현에는 package-lock.json과 npm ci를 사용합니다.

| 패키지 | 설치 버전 | 범위 |
| --- | --- | --- |
| @fontsource-variable/dm-sans | 5.3.0 | dependencies |
| @fontsource-variable/noto-sans-kr | 5.3.1 | dependencies |
| class-variance-authority | 0.7.1 | dependencies |
| clsx | 2.1.1 | dependencies |
| lucide-react | 1.68.0 | dependencies |
| motion | 14.9.1 | dependencies |
| radix-ui | 1.8.1 | dependencies |
| react | 19.3.1 | dependencies |
| react-dom | 19.3.1 | dependencies |
| recharts | 3.10.1 | dependencies |
| tailwind-merge | 3.7.0 | dependencies |
| @playwright/test | 1.64.1 | devDependencies |
| @tailwindcss/vite | 4.3.4 | devDependencies |
| @types/node | 26.6.6 | devDependencies |
| @types/react | 19.3.0 | devDependencies |
| @types/react-dom | 19.3.0 | devDependencies |
| @vitejs/plugin-react | 6.2.1 | devDependencies |
| tailwindcss | 4.3.4 | devDependencies |
| typescript | 7.0.2 | devDependencies |
| vite | 8.3.5 | devDependencies |

포매터 Prettier 3.6.2(MIT)도 프로젝트 devDependency로 고정해 `npm run format`으로 사용합니다. 전역 설치는 하지 않았습니다.

## 인증·비용·추가 접근

현재 홈페이지는 키·로그인·유료 서비스 없이 실행됩니다. 21st MCP·v0·OpenCode를 설치/연결했다고 주장하지 않습니다. 공식 웹 문서 검토를 추가로 하려면 환경 설정에서 `21st.dev`, `ui.aceternity.com`, `www.cult-ui.com`, `v0.app` 접속 허용이 필요합니다. 관련 없는 기존 허용 목록은 바꾸지 않았습니다.

Meta OAuth·실제 실적 수집·시간별 갱신은 미구현이며 인증·호스팅은 별도 작업입니다. 앱의 예시 모드는 데이터 연결의 증거가 아닙니다.

## 검증

TypeScript 및 Vite build 통과. Chromium Playwright 6개 검사 통과, 375·768·1024·1440px screenshot 수집 후 데스크톱/모바일 확인. 실제 Meta API 및 Ads Manager 대조는 수행하지 않았습니다. Git 원격에는 push하지 않았고 사이트/환경을 게시하지 않았습니다.

## 2026-11-05 — 한 계정 Instagram Login 준비

사용자는 사이트에서 Instagram 로그인만 사용하고, 향후 사이트들도 무료 범위로 진행하도록 지정했습니다. `docs/COST_POLICY.md`와 `AGENTS.md`에 반영했습니다.

- `wrangler` 4.157.0 (MIT OR Apache-2.0), `miniflare` 4.20260730.0 (MIT), `@cloudflare/workers-types` 5.20261104.1 (MIT OR Apache-2.0), `esbuild` 0.28.2 (MIT)를 프로젝트 devDependency로 고정했습니다. 전역 설치·서비스 가입·유료 구독은 하지 않았습니다.
- 공식 Cloudflare 문서의 원문을 `cloudflare/cloudflare-docs` production 브랜치에서 읽었습니다: Workers pricing, D1 pricing, static-assets binding 및 worker-script routing. Workers Free의 존재와 정적 자산/서버를 한 주소로 제공하는 설정을 확인했습니다.
- 공식 Meta `facebook/facebook-nodejs-business-sdk` 커밋 `246c937eb5c1272ed743db41a944900bee449be9`의 README 및 버전 근거를 확인했습니다(SDK 26.0.3, Graph API v26.0). 해당 SDK를 앱에 설치하거나 코드를 복사하지는 않았습니다. Instagram OAuth는 별도의 공식 Instagram Login endpoint를 직접 사용합니다.
- 로그인 서버는 실제 Miniflare Workers/D1에서 가짜 외부 응답을 사용한 9개 검사 통과. 브라우저 10개 검사 및 Worker 프론트엔드/타입 빌드 통과. 실제 앱·서버 계정이 없어 실제 Instagram 로그인은 실행하지 않았습니다.
- Instagram 기본 권한을 Marketing API 권한으로 오인하지 않습니다. 계정 프로필 연결 성공은 광고비 조회 성공의 증거가 아닙니다.

Wrangler의 dry-run 패키징도 통과했습니다. 이 환경의 읽기 제한이 있는 홈 디렉터리를 변경하는 대신 명령 범위의 XDG_CONFIG_HOME=/tmp/jbgolf-cloudflare-config, WRANGLER_LOG_PATH=/tmp/jbgolf-wrangler-dryrun.log를 사용했습니다. 인증을 대체하거나 프록시를 끄지 않았으며 실제 Cloudflare 업로드는 하지 않았습니다.

## 2026-11-05 — 실제 무료 Cloudflare 배포

- 기존 프로젝트 범위의 Wrangler 4.157.0(MIT OR Apache-2.0)을 재사용했습니다. 추가 전역 도구나 유료 서비스를 설치하지 않았습니다. 출처: https://github.com/cloudflare/workers-sdk · 공식 API: https://api.cloudflare.com/client/v4/.
- 새 환경에서 `CLOUDFLARE_API_TOKEN` 바인딩이 ready임을 확인하고 공식 토큰 검증 API와 계정 조회 API가 HTTP 200으로 성공했습니다. 값은 출력하지 않았고 기존 HTTPS 프록시·TLS 검증을 유지했습니다.
- 토큰에는 청구 조회 권한이 없어 subscriptions API가 403을 반환했습니다. 권한 확대 대신 사용자가 제공한 Subscriptions 화면의 **Workers Free · Active** 표시로 무료 요금제를 확인했습니다.
- 공식 API와 Wrangler로 workers.dev 주소, D1 데이터베이스, 테이블, Worker·정적 자산·일일 스케줄을 설정했습니다. `TOKEN_ENCRYPTION_KEY`는 메모리에서 생성해 Cloudflare Secret에만 저장했습니다. 실제 키 값은 파일·로그·GitHub에 기록하지 않았습니다.
- 로컬 `wrangler.production.jsonc`는 Git 제외 경로에 생성했습니다. 배포 전후의 설치 의존성과 lockfile은 변경하지 않았습니다.
- 서버 빌드 및 실제 로컬 Workers/D1의 9개 검사 통과. 실제 공개 서버의 홈페이지·API·법적 안내 경로와 Chromium 렌더링도 확인했습니다. 실제 Instagram OAuth·광고 실적 수집의 성공을 뜻하지 않습니다.
- 생성 리소스와 실제 배포 버전, 남은 앱 설정은 [Cloudflare 배포 기록](CLOUDFLARE_DEPLOYMENT.md)에 기록했습니다.

### Meta 개발자 등록의 관리자 조건 확인

2026-11-05 공식 https://developers.facebook.com/documentation/development/register 본문을 조회했습니다. Facebook 계정으로 로그인한 상태에서 개발자 등록을 시작하고 전화·이메일을 확인하도록 안내합니다. Instagram 로그인으로 Business Suite에 들어간 상태를 개발자 등록 성공으로 취급하지 않습니다. 로그인 전 앱 목록의 오류 페이지와 앱 생성 주소의 로그인 리디렉션은 실제 개발자 권한 확인의 증거가 아닙니다. 계정 소유자 또는 회사 담당자의 등록이 남아 있으며, 사이트의 Instagram 전용 로그인 구현은 유지합니다.

이후 사용자가 관리자 단계에서도 Facebook 계정을 사용하지 않도록 명시했으므로 신규 개발자 등록 경로는 중단했습니다. 회사에 기존 소유 앱이 있는지 현재 Instagram/Meta 세션으로 확인하는 경로는 조사할 수 있지만, 유효한 앱 정보와 실제 광고 조회 권한은 아직 확보하지 못했습니다. Facebook 계정 사용을 대안으로 재요청하지 않습니다.

회사 Business Suite 앱 화면에서 ‘추가된 앱 없음’, 추가 메뉴에서 ‘새 앱 ID 만들기’ 비활성화를 확인했습니다. 비활성화의 정확한 원인은 확정하지 않았습니다. 현재 사용자에게 추가 작업을 반복 요청하지 않고 관리자 확인 대기로 기록했으며, [관리자 전달 메모](META_ACCOUNT_HANDOFF.md)에 준비된 주소·현재 상태·필요한 확인사항을 정리했습니다. 홈페이지와 연결 상태 API는 실제 배포 확인용 요청에서 HTTP 200으로 응답했고, 연결 상태는 `configured: false`, `authenticated: false`, `advertisingAccess: false`였습니다.

사용자가 기존 브라우저에서 공식 `/async/registration/` 경로를 직접 열어 확인한 안내에는 현재 WorkPlatform 계정 대신 Facebook 개인 계정으로 전환해야 한다고 명시됐습니다. 포트폴리오 전체 액세스와 개발자 등록 자격을 구분합니다. Facebook 계정 미사용 조건에 따라 ‘WWW로 이동’을 진행하지 않으며, 이 사이트의 Meta 등록·권한 승인·심사 신청은 제출하지 않았습니다.
