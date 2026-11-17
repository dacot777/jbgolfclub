export const CALENDAR_ACCOUNTS = [
  'jbgolfacademy',
  'jbgolfclub_official',
  'jbgolfclub_bundang',
] as const

export type CalendarAccount = (typeof CALENDAR_ACCOUNTS)[number]
export type CalendarKind = 'post' | 'reel'
export const CALENDAR_LIMITS = { title: 160, note: 2000 } as const

export function isCalendarAccount(value: unknown): value is CalendarAccount {
  return CALENDAR_ACCOUNTS.some((account) => account === value)
}

export interface CalendarScheduleInput {
  account: CalendarAccount
  kind: CalendarKind
  date: string
  time: string | null
  title: string
  note: string
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
