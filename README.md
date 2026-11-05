# JB Golf Club

JB골프아카데미·JB골프클럽의 한국어 인스타그램 광고 주간보고 대시보드입니다.

## 현재 구현

- 계정 미연결 상태와 명시적인 예시 데이터 모드
- 핵심 지표, 같은 요일·집계 시점의 주간 비교, 월간 누적 및 일별 차트
- 서로 다른 목표별 결과·가중 결과당 비용, 기간별 고유 도달 fixture
- 같은 데이터로 만든 보고 문장, 예시 경고를 포함한 클립보드 복사
- 캠페인·광고 세트·광고 조회, 이름 검색·브랜드 필터·광고비 정렬·CSV
- 모바일 레이아웃, 키보드 조작 가능한 대화상자와 탭, 모션 줄이기 지원

**현재는 프론트엔드 초안입니다. Meta 로그인, 실제 API 수집, 데이터베이스, 시간별 서버 작업은 아직 구현되지 않았습니다. 예시 수치는 실제 광고 실적이 아닙니다.**

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

브라우저 검사는 시스템 Chromium이 있으면 이를 사용합니다. 없으면 `npx playwright install chromium`으로 설치하거나 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`에 실행 파일 경로를 지정합니다.

GitHub 접속에 사용하는 기존 인증과 HTTPS 프록시를 유지합니다. Codex 명령 샌드박스가 네트워크 소켓을 막으면 허용된 실행 권한 경로를 사용합니다. 프록시나 TLS 검증을 끄지 않습니다.

## GitHub Pages 배포

사용자의 배포 요청에 따라 GitHub Pages의 `/jbgolfclub/` 하위 경로에 맞는 빌드를 추가했습니다.

```bash
npm run build:pages
```

배포 브랜치는 `gh-pages`, 정적 파일 경로는 `/`입니다. 저장소 Settings → Pages의 Source를 **Deploy from a branch**, Branch를 **gh-pages / (root)**로 지정해야 합니다. 이는 실제 Meta API 서버의 배포를 포함하지 않습니다.

## 문서

- [도구 검증·설치·선택 내역](docs/TOOLING.md)
- [디자인 기준](docs/DESIGN.md)
- [구조와 실제 연동의 남은 범위](docs/ARCHITECTURE.md)
- [구현 및 검증 기록](docs/PLAN.md)

외부 자료 전체를 통째로 설치하거나 기존 규칙을 덮어쓰지 않았습니다. 실제 사용한 shadcn 기본 컴포넌트와 Magic UI 숫자 효과의 라이선스를 `docs/licenses/`에 보존했습니다.
