# JB Golf Club

JB골프아카데미·JB골프클럽의 한국어 인스타그램 광고 주간보고 대시보드입니다.

## 현재 구현

- **비공개 방문 기록**: 로고 위 빈 공간 세 번 클릭으로 관리자 로그인, 익명 방문자·접속 시각·메뉴별 활성 체류 조회. [운영 및 개인정보 기준](docs/ADMIN_ANALYTICS.md)
- **기사·블로그 워크스페이스**: 9개 회사 키워드의 공개 기사·개인 블로그 후기 검색, 언론사/작성자·썸네일·원문 링크, PC 3열과 메뉴 진입 시 자동 갱신. [검색·보관 기준](docs/MEDIA_MONITOR.md)
- **성과 대시보드의 캡처 확인 자료**: 사용자가 채팅으로 제공한 수치·게시물 링크를 확인해 기존 D1에 반영하고 월/7일 단위로 이전 기록을 조회합니다. 업로드 화면이나 브라우저 백업 작업은 필요하지 않습니다. 실제 자료는 공개 소스에 포함하지 않습니다. [자료 반영 기준](docs/REVIEWED_PERFORMANCE.md)
- **광고 자동 보고서**(`#ad-report`)에서 관리자가 Instagram 광고의 주간·월간 실적과 마지막 수집 시각을 확인할 수 있습니다. 운영 배포와 회사 광고 계정의 성과 조회 권한 설정이 필요합니다. [Meta 광고 연결 및 배포](docs/META_ADS_REPORT.md)
- 계정 미연결 상태와 명시적인 예시 데이터 모드
- 핵심 지표, 같은 요일·집계 시점의 주간 비교, 월간 누적 및 일별 차트
- 서로 다른 목표별 결과·가중 결과당 비용, 기간별 고유 도달 fixture
- 같은 데이터로 만든 보고 문장, 예시 경고를 포함한 클립보드 복사
- 캠페인·광고 세트·광고 조회, 이름 검색·브랜드 필터·광고비 정렬·CSV
- 모바일 레이아웃, 키보드 조작 가능한 대화상자와 탭, 모션 줄이기 지원

**연결용 서버를 Workers Free + D1에 배포했습니다:** https://jbgolf-connection.jbgolfacademy.workers.dev/

인스타그램 공식 로그인용 서버·데이터베이스·암호화 키를 설정했습니다. Instagram 앱 등록과 계정 소유자 승인은 대기 중입니다. 광고 자동 보고서는 회사 광고 계정의 성과 조회 권한으로 Marketing API를 호출합니다. 2026년 11월 11일 기준 실제 광고 API 연결 및 첫 운영 수집은 확인 대기 상태입니다. [기존 운영 배포 기록](docs/CLOUDFLARE_DEPLOYMENT.md)

## 실행

Node.js 24 LTS와 npm을 사용합니다.

```bash
npm ci
npm run dev
```

```bash
npm run build
npm test
```

인스타그램 로그인 서버의 로컬 검증:

```bash
npm run build:worker
npm run test:worker
```

서버 설정은 [한 계정 연결 준비 안내](docs/INSTAGRAM_SETUP.md)를 따릅니다. 앱 비밀키·토큰·비밀번호를 채팅이나 GitHub에 올리지 않습니다. 모든 호스팅·도구 도입은 [무료 요금제 원칙](docs/COST_POLICY.md)을 따릅니다.

브라우저 검사는 시스템 Chromium이 있으면 이를 사용합니다. 없으면 `npx playwright install chromium`으로 설치하거나 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`에 실행 파일 경로를 지정합니다.

GitHub 접속에 사용하는 기존 인증과 HTTPS 프록시를 유지합니다. Codex 명령 샌드박스가 네트워크 소켓을 막으면 허용된 실행 권한 경로를 사용합니다. 프록시나 TLS 검증을 끄지 않습니다.

## GitHub Pages 배포

사용자의 배포 요청에 따라 GitHub Pages의 `/jbgolfclub/` 하위 경로에 맞는 빌드를 추가했습니다.

```bash
npm run build:pages
```

공개 주소: **https://dacot777.github.io/jbgolfclub/**

배포 브랜치는 `gh-pages`, 정적 파일 경로는 `/`이며 GitHub Pages가 자동 활성화되었습니다. 첫 배포의 GitHub 실행 기록은 성공입니다. 이는 실제 Meta API 서버의 배포를 포함하지 않습니다. 배포 상태와 갱신 절차는 [배포 기록](docs/DEPLOYMENT.md)을 참고하세요.

## 문서

- [캡처 확인 자료와 주간 이력 반영 기준](docs/REVIEWED_PERFORMANCE.md)
- [도구 검증·설치·선택 내역](docs/TOOLING.md)
- [디자인 기준](docs/DESIGN.md)
- [구조와 실제 연동의 남은 범위](docs/ARCHITECTURE.md)
- [구현 및 검증 기록](docs/PLAN.md)
- [한 인스타그램 계정 연결 준비](docs/INSTAGRAM_SETUP.md)
- [비용 원칙](docs/COST_POLICY.md)
- [무료 서버의 계정·권한 준비](docs/CLOUDFLARE_FREE_SETUP.md)

외부 자료 전체를 통째로 설치하거나 기존 규칙을 덮어쓰지 않았습니다. 실제 사용한 shadcn 기본 컴포넌트와 Magic UI 숫자 효과의 라이선스를 `docs/licenses/`에 보존했습니다.
