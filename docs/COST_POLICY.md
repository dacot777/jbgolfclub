# 비용 원칙

사용자 지시(2026-11-05): 앞으로 만드는 사이트도 무료 요금제 범위로 진행합니다.

추가 지시: **비용은 절대 지출하지 않습니다.** 유료 구독, 자동 과금 전환, 유료 API, 유료 도메인 구매를 진행하지 않습니다. 무료 범위를 확인할 수 없는 서비스는 활성화하지 않습니다.

- 현재 프론트엔드는 공개 GitHub 저장소의 GitHub Pages를 사용합니다.
- 계정 연결 서버는 Cloudflare Workers **Free**와 D1 무료 범위를 기준으로 준비합니다. 유료 Workers 플랜을 구독하거나 자동 업그레이드하지 않습니다.
- 무료 한도를 넘으면 유료 전환 대신 한도와 기능 조정을 사용자에게 알립니다. 이미 유료로 설정된 외부 계정은 배포 전에 확인해야 합니다.
- 무료 한도를 초과하면 기능을 일시 중지하거나 수집 주기·저장량을 줄입니다. 한도 초과를 이유로 유료 전환을 진행하지 않습니다.
- 광고 집행 지출과 별개로 이 원칙은 사이트의 호스팅·도구 도입 비용에 적용합니다.

확인한 Cloudflare 공식 문서에 따르면 Workers Free의 동적 요청 한도는 일 100,000회이며, 정적 자산 요청은 무료입니다. D1도 Free 플랜에서 제공됩니다. 약관·무료 한도는 실제 배포 시 다시 확인하며 무제한 무료 서비스를 보장하지 않습니다.

## 확인한 무료 한도

2026-11-05 Cloudflare 공식 문서 저장소 `434ad44206263b4782d6b773e0ee224f55be7214` 기준입니다. 새 페이지/사이트마다 별도 무료 사용량이 생기는 방식이 아니며 한 계정의 공통 한도를 함께 사용합니다.

| 항목 | 무료 범위 |
| --- | --- |
| Worker 정적 자산 직접 제공 | 요청 무료·무제한, 자산 저장 추가 요금 없음. Worker 코드가 실행되는 요청은 아래 동적 한도에 포함 |
| Workers 동적 실행 | 계정 합산 하루 100,000회. 1회 CPU 10ms 제한(네트워크 대기 시간 제외) |
| D1 읽기 | 계정 합산 하루 5,000,000행 |
| D1 쓰기 | 계정 합산 하루 100,000행 |
| D1 저장 공간 | 계정 합산 5GB, DB당 최대 500MB, 무료 DB 최대 10개 |
| Worker 수 | 무료 계정 최대 100개. 웹페이지 수 제한을 의미하지 않음 |

Workers Free나 D1 Free의 사용량 한도를 초과하면 요청/쿼리가 오류를 반환하거나 저장 작업이 제한됩니다. Free 상태에서 이를 자동으로 유료 업그레이드하는 운영을 하지 않습니다.

2026-11-05 사용자가 제공한 계정의 Subscriptions 화면에서 **Workers Free · Active**를 확인한 뒤 Worker 1개와 D1 데이터베이스 1개를 만들었습니다. 유료 구독·플랜 변경·결제 수단 등록 API는 호출하지 않았습니다. 실제 서버 주소와 검증 범위는 [배포 기록](CLOUDFLARE_DEPLOYMENT.md)에 있습니다.

출처: https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/d1/platform/pricing/

추가 출처: https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
