export const PRODUCT_LABELS = {
  camp: '전지훈련',
  lesson: '레슨',
  other: '기타',
} as const
export const BRANCH_LABELS = {
  hanam: '하남',
  cheongdam: '청담',
  seohyeon: '서현',
} as const
export const CHANNEL_LABELS = {
  kakao: '카카오채널',
  instagram_dm: '인스타그램 DM',
  phone: '전화',
  other: '기타',
} as const
export const SOURCE_LABELS = {
  unknown: '미확인',
  instagram_ad: '인스타그램 광고',
  instagram_post: '인스타그램 게시물',
  search: '검색',
  referral: '지인 소개',
  other: '기타',
} as const
export const STAGE_LABELS = {
  received: '문의 접수',
  consulting: '상담 중',
  completed: '신청·등록 완료',
  closed: '상담 종료',
} as const
export const ASSIGNEE_LABELS = {
  unassigned: '미배정',
  kim_yeoul: '김여울 대리님',
  kim_uihyeon: '김의현 원장님',
} as const
export const INQUIRY_LIMITS = {
  name: 80,
  contact: 120,
  note: 1500,
  nextAction: 300,
} as const

export interface InquiryInput {
  firstDate: string | null
  product: keyof typeof PRODUCT_LABELS
  branch: keyof typeof BRANCH_LABELS | null
  channel: keyof typeof CHANNEL_LABELS
  source: keyof typeof SOURCE_LABELS
  adId: string | null
  stage: keyof typeof STAGE_LABELS
  assignee: keyof typeof ASSIGNEE_LABELS
  name: string
  contact: string
  note: string
  nextAction: string
}

export interface Inquiry extends InquiryInput {
  id: string
  version: number
}
