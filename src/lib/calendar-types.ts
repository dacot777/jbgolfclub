export const CALENDAR_ACCOUNTS = [
  'jbgolfacademy',
  'jbgolfclub_official',
  'jbgolfclub_bundang',
] as const

export type CalendarAccount = (typeof CALENDAR_ACCOUNTS)[number]
export type CalendarKind = 'post' | 'reel'
export const CALENDAR_BRANDS = {
  club: 'JB골프클럽',
  academy: 'JB아카데미',
  haus: '하우스 오브 제이비(Haus of JB)',
} as const
export const CALENDAR_BRANCHES = {
  cheongdam: '청담',
  seohyeon: '서현',
} as const
export type CalendarBrand = keyof typeof CALENDAR_BRANDS
export type CalendarBranch = keyof typeof CALENDAR_BRANCHES

export function calendarOrganizationForAccount(account: CalendarAccount): {
  brand: CalendarBrand
  branch: CalendarBranch | null
} {
  if (account === 'jbgolfacademy') return { brand: 'academy', branch: null }
  return {
    brand: 'club',
    branch: account === 'jbgolfclub_bundang' ? 'seohyeon' : null,
  }
}
export const CALENDAR_LIMITS = { title: 160, note: 2000 } as const

export function isCalendarAccount(value: unknown): value is CalendarAccount {
  return CALENDAR_ACCOUNTS.some((account) => account === value)
}

export interface CalendarScheduleInput {
  account: CalendarAccount | null
  brand?: CalendarBrand
  branch?: CalendarBranch | null
  kind: CalendarKind
  date: string
  time: string | null
  title: string
  note: string
  permalink?: string | null
}
export interface CalendarSchedule extends CalendarScheduleInput {
  id: string
  version: number
}
export interface CalendarPost {
  id: string
  account: CalendarAccount
  kind: CalendarKind
  title: string
  date: string
  time: string
  thumbnailUrl: string | null
  permalink: string
}
export interface CalendarAccountStatus {
  account: CalendarAccount
  status:
    | 'connected'
    | 'needs_connection'
    | 'syncing'
    | 'error'
    | 'setup_required'
  lastSyncedAt: string | null
}
export interface CalendarMonth {
  month: string
  schedules: CalendarSchedule[]
  posts: CalendarPost[]
  accounts: CalendarAccountStatus[]
}
