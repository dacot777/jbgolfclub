import {
  CALENDAR_LIMITS,
  isCalendarAccount,
  type CalendarSchedule,
  type CalendarScheduleInput,
} from '../src/lib/calendar-types'
import type { Env } from './types'

const columns =
  'id,version,account,kind,day AS date,local_time AS time,title,note'
const monthFormat = /^\d{4}-(0[1-9]|1[0-2])$/
const dayFormat = /^\d{4}-\d{2}-\d{2}$/
const timeFormat = /^([01]\d|2[0-3]):[0-5]\d$/
const uuidFormat = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

export class CalendarError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code)
  }
}

export function calendarMonth(value: string | null): string {
  if (!value || !monthFormat.test(value))
    throw new CalendarError('invalid_calendar_month', 400)
  return value
}

function idFrom(value: unknown) {
  if (typeof value !== 'string' || !uuidFormat.test(value))
    throw new CalendarError('invalid_calendar_id', 400)
  return value.toLowerCase()
}

function versionFrom(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new CalendarError('invalid_calendar_version', 400)
  return value
}

function inputFrom(raw: Record<string, unknown>): CalendarScheduleInput {
  const { account, kind, date, time, title, note } = raw
  if (
    !isCalendarAccount(account) ||
    (kind !== 'post' && kind !== 'reel') ||
    typeof date !== 'string' ||
    !dayFormat.test(date) ||
    (time !== null && (typeof time !== 'string' || !timeFormat.test(time))) ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > CALENDAR_LIMITS.title ||
    typeof note !== 'string' ||
    note.length > CALENDAR_LIMITS.note ||
    title.includes('\u0000') ||
    note.includes('\u0000')
  )
    throw new CalendarError('invalid_calendar_schedule', 400)
  const day = new Date(date + 'T00:00:00Z')
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== date
  )
    throw new CalendarError('invalid_calendar_date', 400)
  return { account, kind, date, time, title: title.trim(), note }
}

function parameters(input: CalendarScheduleInput) {
  return [
    input.account,
    input.kind,
    input.date,
    input.time,
    input.title,
    input.note,
  ]
}

export async function listSchedules(env: Env, month: string) {
  // Plans store Korean civil dates, including all-day plans; UTC midnight would shift date filters.
  const rows = await env.DB.prepare(
    'SELECT ' +
      columns +
      ' FROM calendar_schedules WHERE day BETWEEN ? AND ? ORDER BY day,local_time,id',
  )
    .bind(month + '-01', month + '-31')
    .all<CalendarSchedule>()
  return rows.results
}

export async function createSchedule(
  env: Env,
  raw: Record<string, unknown>,
  fingerprintFor: (value: string) => Promise<string>,
) {
  const id = idFrom(raw.id)
  const input = inputFrom(raw)
  const fingerprint = await fingerprintFor(
    'calendar-create:' + id + ':' + JSON.stringify(input),
  )
  const created = await env.DB.prepare(
    'INSERT INTO calendar_schedules(id,account,kind,day,local_time,title,note,creation_fingerprint) ' +
      'VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING ' +
      columns,
  )
    .bind(id, ...parameters(input), fingerprint)
    .first<CalendarSchedule>()
  if (created) return created
  // A retry after a later edit returns the latest record. Deletion clears the fingerprint.
  const replay = await env.DB.prepare(
    'SELECT ' +
      columns +
      ' FROM calendar_schedules WHERE id=? AND creation_fingerprint=?',
  )
    .bind(id, fingerprint)
    .first<CalendarSchedule>()
  if (replay) return replay
  throw new CalendarError('calendar_conflict', 409)
}

async function exists(env: Env, id: string) {
  return env.DB.prepare(
    'SELECT 1 AS present FROM calendar_schedules WHERE id=? AND day IS NOT NULL',
  )
    .bind(id)
    .first()
}

export async function updateSchedule(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  const id = idFrom(idValue)
  const version = versionFrom(raw.version)
  const input = inputFrom(raw)
  const updated = await env.DB.prepare(
    'UPDATE calendar_schedules SET account=?,kind=?,day=?,local_time=?,title=?,note=?,version=version+1 ' +
      'WHERE id=? AND version=? AND day IS NOT NULL RETURNING ' +
      columns,
  )
    .bind(...parameters(input), id, version)
    .first<CalendarSchedule>()
  if (updated) return updated
  if (await exists(env, id)) throw new CalendarError('calendar_conflict', 409)
  throw new CalendarError('calendar_not_found', 404)
}

export async function deleteSchedule(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  const id = idFrom(idValue)
  const version = versionFrom(raw.version)
  // Retain just a retired ID and version so a late creation replay cannot restore deleted details.
  const result = await env.DB.prepare(
    'UPDATE calendar_schedules SET account=NULL,kind=NULL,day=NULL,local_time=NULL,title=NULL,note=NULL,' +
      'creation_fingerprint=NULL,version=version+1 WHERE id=? AND version=? AND day IS NOT NULL',
  )
    .bind(id, version)
    .run()
  if (!result.meta.changes && (await exists(env, id)))
    throw new CalendarError('calendar_conflict', 409)
  return { deleted: true }
}
