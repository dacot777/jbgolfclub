import type { AdRow, Result, Summary } from './report'
// 화면 검토용 합성 데이터. 실제 Meta 실적으로 사용하지 않습니다.
export const DEMO_AS_OF = '2026-11-05T14:00:00+09:00'
export const current: Summary = {
  spend: 864500,
  reach: 42380,
  impressions: 72912,
  clicks: 1248,
}
export const previous: Summary = {
  spend: 781000,
  reach: 39800,
  impressions: 68200,
  clicks: 1010,
}
// 도달은 기간 고유값 fixture이며 일별/광고별 도달을 더하지 않습니다.
export const month: Summary = {
  spend: 1102500,
  reach: 51180,
  impressions: 93112,
  clicks: 1590,
}
export const results: Result[] = [
  {
    name: '링크 클릭',
    type: 'link_click',
    count: 654,
    spend: 412500,
    unit: '회',
  },
  {
    name: '랜딩 페이지 조회',
    type: 'landing_page_view',
    count: 416,
    spend: 452000,
    unit: '회',
  },
]
export const monthResults: Result[] = [
  {
    name: '링크 클릭',
    type: 'link_click',
    count: 972,
    spend: 560500,
    unit: '회',
  },
  {
    name: '랜딩 페이지 조회',
    type: 'landing_page_view',
    count: 548,
    spend: 542000,
    unit: '회',
  },
]
export const daily = [
  {
    day: '월',
    date: '11.02',
    spend: 195000,
    beforeSpend: 210000,
    clicks: 276,
    beforeClicks: 246,
  },
  {
    day: '화',
    date: '11.03',
    spend: 220500,
    beforeSpend: 197000,
    clicks: 315,
    beforeClicks: 256,
  },
  {
    day: '수',
    date: '11.04',
    spend: 248000,
    beforeSpend: 200500,
    clicks: 364,
    beforeClicks: 270,
  },
  {
    day: '목',
    date: '11.05',
    spend: 201000,
    beforeSpend: 173500,
    clicks: 293,
    beforeClicks: 238,
  },
  {
    day: '금',
    date: '11.06',
    spend: null,
    beforeSpend: null,
    clicks: null,
    beforeClicks: null,
  },
  {
    day: '토',
    date: '11.07',
    spend: null,
    beforeSpend: null,
    clicks: null,
    beforeClicks: null,
  },
  {
    day: '일',
    date: '11.08',
    spend: null,
    beforeSpend: null,
    clicks: null,
    beforeClicks: null,
  },
]
export const monthlyDaily = [
  { day: '1일', spend: 238000, results: 132 },
  { day: '2일', spend: 195000, results: 96 },
  { day: '3일', spend: 220500, results: 110 },
  { day: '4일', spend: 248000, results: 120 },
  { day: '5일', spend: 201000, results: 90 },
]
const raw: AdRow[] = [
  {
    id: '1',
    name: '아카데미 · 레슨 소개 릴스',
    brand: 'JB골프아카데미',
    objective: '링크 클릭',
    spend: 280000,
    reach: 19000,
    impressions: 25000,
    clicks: 436,
    result: 436,
  },
  {
    id: '2',
    name: '아카데미 · 스윙 클래스 피드',
    brand: 'JB골프아카데미',
    objective: '링크 클릭',
    spend: 132500,
    reach: 10000,
    impressions: 12500,
    clicks: 218,
    result: 218,
  },
  {
    id: '3',
    name: '골프클럽 · 시설 소개 릴스',
    brand: 'JB골프클럽',
    objective: '랜딩 페이지 조회',
    spend: 302000,
    reach: 15000,
    impressions: 23512,
    clicks: 398,
    result: 277,
  },
  {
    id: '4',
    name: '골프클럽 · 연습장 피드',
    brand: 'JB골프클럽',
    objective: '랜딩 페이지 조회',
    spend: 150000,
    reach: 8000,
    impressions: 11900,
    clicks: 196,
    result: 139,
  },
]
export const detailRows: Record<string, AdRow[]> = {
  ad: raw,
  adset: [
    { ...raw[0], id: 's1', name: '아카데미 · Instagram 릴스' },
    { ...raw[1], id: 's2', name: '아카데미 · Instagram 피드' },
    {
      ...raw[2],
      id: 's3',
      name: '골프클럽 · Instagram',
      spend: 452000,
      reach: 20500,
      impressions: 35412,
      clicks: 594,
      result: 416,
    },
  ],
  campaign: [
    {
      ...raw[0],
      id: 'c1',
      name: 'JB골프아카데미 · 레슨 소개',
      spend: 412500,
      reach: 26500,
      impressions: 37500,
      clicks: 654,
      result: 654,
    },
    {
      ...raw[2],
      id: 'c2',
      name: 'JB골프클럽 · 공간 소개',
      spend: 452000,
      reach: 20500,
      impressions: 35412,
      clicks: 594,
      result: 416,
    },
  ],
}
