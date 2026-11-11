# Instagram 광고 자동 보고서

기존 사이트의 **광고 자동 보고서**(`#ad-report`)에서 관리자 로그인을 하면 광고 계정의 지난주·이번 주와 지난달·이번 달 실적, 광고별 일일 기록과 마지막 성공 시각을 확인할 수 있습니다. 서버는 Meta가 반환한 광고 계정 시간대·통화를 사용하고 Instagram 게재분만 집계합니다. 도달은 해당 주·월 전체에 대해 Meta가 집계한 값을 사용합니다.

## 회사 광고 계정 연결

회사에서 사용하도록 승인한 Meta 앱을 통해 대상 광고 계정의 성과를 조회할 수 있는 서버용 액세스 토큰(`ads_read`)을 준비합니다. 회사 관리자가 Meta에서 발급한 토큰은 기존 Cloudflare Worker **jbgolf-connection → Settings → Variables and Secrets**에 **Secret** 유형의 `META_ADS_ACCESS_TOKEN`으로 입력합니다. 이 값은 채팅·Git·브라우저 저장소에 기록하지 않습니다. [Meta Marketing API 권한 안내](https://developers.facebook.com/docs/marketing-api/get-started/authorization/) · [Cloudflare Secret 관리](https://developers.cloudflare.com/workers/configuration/secrets/)

Git 제외 파일 `wrangler.production.jsonc`의 `META_AD_ACCOUNT_ID`에는 대상 광고 계정 번호, `META_ADS_API_VERSION`에는 Graph API 버전을 지정합니다. Instagram 프로필 로그인과 광고 읽기 권한은 독립적으로 설정할 수 있습니다. 2026년 11월 11일에는 실제 광고 조회와 운영 배포를 검증하기 전입니다.

## 기존 Worker에 배포하기

1. Cloudflare 계정 **Billing → Subscriptions**에서 **Workers Free · Active**를 확인합니다. `wrangler.production.jsonc`의 Worker 이름과 D1 ID가 기존 리소스와 일치하는지 대조합니다. `keep_vars: true`로 원격 변수를 유지하고, 운영에 `INSTAGRAM_APP_ID`가 설정되어 있으면 기존 공개 값을 로컬 운영 설정과 동기화합니다. [운영 리소스 및 배포 기록](CLOUDFLARE_DEPLOYMENT.md)
2. 기존 D1에는 0001–0004가 적용돼 있습니다. 과거 적용 이력이 Wrangler 마이그레이션 목록과 일치하는지 확인되지 않았으므로 이 DB에서는 신규 파일 **0005**만 한 번 실행합니다. 이미 두 광고 수집 테이블과 인덱스가 적용된 DB라면 이 단계를 건너뜁니다.

   ```sh
   npx wrangler d1 execute jbgolf-single-instagram --remote --config wrangler.production.jsonc --file worker/migrations/0005_meta_ads.sql
   ```

3. 프런트엔드 및 Worker 검사를 마치고 `npm run deploy:worker`로 기존 Worker에 배포합니다. 예약 실행은 매시 15분에 광고를 갱신하고 매일 UTC 00:00에 기존 정리·토큰 유지 작업을 실행합니다.
4. 배포 후 대시보드의 **광고 자동 보고서**를 열어 기존 관리자 계정으로 로그인합니다. 첫 수집이 끝나면 마지막 성공 시각을 확인하고, 완료된 주 하나를 골라 Meta 광고 관리자에서 같은 계정·기간·시간대의 Instagram 게재분과 지출·노출·링크 클릭·도달을 대조합니다. 설정 또는 수집에 실패한 기간은 확인 전까지 미수집으로 취급합니다.
