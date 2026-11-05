# 비용 원칙

사용자 지시(2026-11-05): 앞으로 만드는 사이트도 무료 요금제 범위로 진행합니다.

- 현재 프론트엔드는 공개 GitHub 저장소의 GitHub Pages를 사용합니다.
- 계정 연결 서버는 Cloudflare Workers **Free**와 D1 무료 범위를 기준으로 준비합니다. 유료 Workers 플랜을 구독하거나 자동 업그레이드하지 않습니다.
- 무료 한도를 넘으면 유료 전환 대신 한도와 기능 조정을 사용자에게 알립니다. 이미 유료로 설정된 외부 계정은 배포 전에 확인해야 합니다.
- 광고 집행 지출과 별개로 이 원칙은 사이트의 호스팅·도구 도입 비용에 적용합니다.

확인한 Cloudflare 공식 문서에 따르면 Workers Free의 동적 요청 한도는 일 100,000회이며, 정적 자산 요청은 무료입니다. D1도 Free 플랜에서 제공됩니다. 약관·무료 한도는 실제 배포 시 다시 확인하며 무제한 무료 서비스를 보장하지 않습니다.

출처: https://developers.cloudflare.com/workers/platform/pricing/ · https://developers.cloudflare.com/d1/platform/pricing/
