# Instagram 광고 자동 보고서

기존 사이트의 **성과 대시보드**(`#overview`)에 Instagram 광고 실적이 바로 표시됩니다. 방문자는 로그인 없이 주간·월간 실적, 광고별 일일 기록과 마지막 수집 시각을 확인할 수 있습니다. 이전 주소 `#ad-report`도 이 대시보드의 광고 실적 영역을 엽니다. 방문 통계는 기존 관리자 로그인으로 조회합니다. 서버는 광고 계정의 시간대·통화를 기준으로 Instagram 게재분만 집계하며, 도달은 Meta가 해당 주·월 단위로 계산한 값을 사용합니다.

## 회사 광고 계정 연결

회사에서 사용하도록 승인한 Meta 앱을 통해 대상 광고 계정의 성과를 조회할 수 있는 서버용 액세스 토큰(`ads_read`)을 준비합니다. 회사 관리자가 Meta에서 발급한 토큰은 기존 Cloudflare Worker **jbgolf-connection → Settings → Variables and Secrets**에 **Secret** 유형의 `META_ADS_ACCESS_TOKEN`으로 입력합니다. 이 값은 채팅·Git·브라우저 저장소에 기록하지 않습니다. [Meta Marketing API 권한 안내](https://developers.facebook.com/docs/marketing-api/get-started/authorization/) · [Cloudflare Secret 관리](https://developers.cloudflare.com/workers/configuration/secrets/)

Git 제외 파일 `wrangler.production.jsonc`의 `META_AD_ACCOUNT_ID`에는 대상 광고 계정 번호, `META_ADS_API_VERSION`에는 Graph API 버전을 지정합니다. Instagram 프로필 로그인과 광고 읽기 권한은 독립적으로 설정합니다.

2026년 11월 11일 Workers Free에서 공개 광고 보고서를 배포했습니다. 기존 D1에 마이그레이션 `0005`를 적용했고 운영 Worker에 읽기 전용 토큰을 Secret으로 저장했습니다. 한국 시간 14시 29분에 시작한 첫 수집이 성공했습니다. 주간·월간 지출, 노출, 링크 클릭은 같은 기간 광고별 일일 값의 합과 일치했습니다. 광고 관리자에서 동일 조건으로 대조하는 작업은 남아 있습니다. [운영 버전 및 배포 기록](CLOUDFLARE_DEPLOYMENT.md)

## 기존 Worker에 배포하기

1. Cloudflare의 **Compute → Workers plans**에서 **Free** 아래에 **Current plan**이 표시되는지 확인합니다. `wrangler.production.jsonc`의 Worker 이름과 D1 ID가 기존 리소스와 일치하는지 대조합니다. `keep_vars: true`로 원격 변수를 유지하고, 운영에 `INSTAGRAM_APP_ID`가 설정되어 있으면 기존 공개 값을 로컬 운영 설정과 동기화합니다. [운영 리소스 및 배포 기록](CLOUDFLARE_DEPLOYMENT.md)
2. 기존 운영 D1에는 0001–0005가 적용돼 있습니다. 이후 배포에서는 운영 D1의 스키마를 확인하고 새 변경분만 적용합니다.

3. 프런트엔드 및 Worker 검사를 마치고 `npm run deploy:worker`로 기존 Worker에 배포합니다. 예약 실행은 매시 15분에 광고를 갱신하고 매일 UTC 00:00에 기존 정리·토큰 유지 작업을 실행합니다.
4. 배포 후 로그인하지 않은 브라우저에서 `#overview`를 열어 광고 실적을 확인하고, 기존 `#ad-report` 링크도 같은 영역을 여는지 확인합니다. 첫 수집이 끝나면 마지막 성공 시각을 확인하고, 완료된 주 하나를 골라 Meta 광고 관리자에서 같은 계정·기간·시간대의 Instagram 게재분과 지출·노출·링크 클릭·도달을 대조합니다. 설정 또는 수집에 실패한 기간은 확인 전까지 미수집으로 취급합니다.
