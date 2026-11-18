import {
  CALENDAR_LIMITS,
  calendarOrganizationForAccount,
  isCalendarAccount,
  isCalendarScheduleKind,
  type CalendarBranch,
  type CalendarBrand,
  type CalendarSchedule,
  type CalendarScheduleInput,
} from '../src/lib/calendar-types'
import { parseCalendarPermalink } from '../src/lib/calendar-permalink'
import type { Env } from './types'

const columns =
  'id,version,account,brand,branch,kind,day AS date,local_time AS time,title,note,permalink'
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

function todayInSeoul() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
}

function organizationFrom(raw: Record<string, unknown>) {
  const { account, brand, branch } = raw
  if (isCalendarAccount(account)) {
    const owner = calendarOrganizationForAccount(account)
    if (
      (brand !== undefined && brand !== owner.brand) ||
      (branch !== undefined && branch !== owner.branch)
    )
      throw new CalendarError('invalid_calendar_brand', 400)
    return { account, ...owner }
  }
  if (account == null) {
    if (brand === 'club' && (branch === 'cheongdam' || branch === 'seohyeon'))
      return { account: null, brand, branch } as const
    if ((brand === 'academy' || brand === 'haus') && branch == null)
      return { account: null, brand, branch: null } as const
  }
  throw new CalendarError('invalid_calendar_brand', 400)
}

function inputFrom(raw: Record<string, unknown>): CalendarScheduleInput & {
  brand: CalendarBrand
  branch: CalendarBranch | null
} {
  const { account, brand, branch } = organizationFrom(raw)
  const { kind, date, time, title, note } = raw
  if (
    !isCalendarScheduleKind(kind) ||
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
  const input = {
    account,
    kind,
    date,
    time,
    title: title.trim(),
    note,
    brand,
    branch,
  } satisfies CalendarScheduleInput
  // Keep the original creation fingerprint for pre-link requests and their retries.
  if (raw.permalink == null || raw.permalink === '') return input
  const link = account && parseCalendarPermalink(raw.permalink, account)
  if (!link || link.kind !== kind)
    throw new CalendarError('invalid_calendar_permalink', 400)
  if (date > todayInSeoul())
    throw new CalendarError('future_calendar_publication', 400)
  return { ...input, permalink: link.permalink }
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
  // An API timestamp supersedes the date supplied with a staff link, even across months.
  // Keep its editable ID and private note alongside the corresponding official media.
  const rows = await env.DB.prepare(
    `SELECT s.id, s.version, s.account, s.brand, s.branch, s.kind, COALESCE(m.date, s.day) AS date,
       COALESCE(m.time, s.local_time) AS time, s.title, s.note, s.permalink
     FROM calendar_schedules s LEFT JOIN calendar_instagram_media m ON m.id = (
       SELECT id FROM calendar_instagram_media WHERE s.permalink IS NOT NULL AND account=s.account
         AND replace(replace(replace(permalink, '/reel/', '/p/'), '/reels/', '/p/'), '/tv/', '/p/')=replace(s.permalink, '/reel/', '/p/')
       ORDER BY id LIMIT 1
     ) WHERE s.day IS NOT NULL AND COALESCE(m.date, s.day) BETWEEN ? AND ? ORDER BY date,time,s.id`,
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
  const { brand, branch, ...legacy } = input
  const fingerprint = await fingerprintFor(
    'calendar-create:' +
      id +
      ':' +
      JSON.stringify(raw.brand === undefined ? legacy : input),
  )
  const created = await env.DB.prepare(
    'INSERT INTO calendar_schedules(id,account,kind,day,local_time,title,note,creation_fingerprint,permalink,scheduled_brand,scheduled_branch) ' +
      'VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING ' +
      columns,
  )
    .bind(
      id,
      ...parameters(input),
      fingerprint,
      input.permalink ?? null,
      input.account ? null : brand,
      input.account ? null : branch,
    )
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
  await checkDuplicateLink(env, id, input)
  throw new CalendarError('calendar_conflict', 409)
}

async function checkDuplicateLink(
  env: Env,
  id: string,
  input: CalendarScheduleInput,
) {
  if (!input.permalink) return
  const duplicate = await env.DB.prepare(
    "SELECT 1 FROM calendar_schedules WHERE id<>? AND account=? AND permalink IS NOT NULL AND replace(permalink,'/reel/','/p/')=?",
  )
    .bind(id, input.account, input.permalink.replace('/reel/', '/p/'))
    .first()
  if (duplicate) throw new CalendarError('calendar_duplicate_permalink', 409)
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
  const setLink = raw.permalink !== undefined
  const updated = await env.DB.prepare(
    'UPDATE OR IGNORE calendar_schedules SET account=?,kind=?,day=?,local_time=?,title=?,note=?,' +
      'scheduled_brand=?,scheduled_branch=?,permalink=CASE WHEN ? THEN ? ELSE permalink END, version=version+1 ' +
      'WHERE id=? AND version=? AND day IS NOT NULL AND (? OR permalink IS NULL OR (account=? AND kind=? AND ?)) RETURNING ' +
      columns,
  )
    .bind(
      ...parameters(input),
      input.account ? null : input.brand,
      input.account ? null : input.branch,
      +setLink,
      input.permalink ?? null,
      id,
      version,
      +setLink,
      input.account,
      input.kind,
      Number(input.date <= todayInSeoul()),
    )
    .first<CalendarSchedule>()
  if (updated) return updated
  if (await exists(env, id)) {
    await checkDuplicateLink(env, id, input)
    throw new CalendarError('calendar_conflict', 409)
  }
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
    'UPDATE calendar_schedules SET account=NULL,scheduled_brand=NULL,scheduled_branch=NULL,kind=NULL,day=NULL,local_time=NULL,title=NULL,note=NULL,' +
      'creation_fingerprint=NULL,permalink=NULL,version=version+1 WHERE id=? AND version=? AND day IS NOT NULL',
  )
    .bind(id, version)
    .run()
  if (!result.meta.changes && (await exists(env, id)))
    throw new CalendarError('calendar_conflict', 409)
  return { deleted: true }
}

function publicSchedule(item: CalendarSchedule): CalendarSchedule {
  return { ...item, note: '' }
}

function ordinaryScheduleInput(raw: Record<string, unknown>) {
  if (raw.permalink != null && raw.permalink !== '')
    throw new CalendarError('calendar_publication_read_only', 403)
  return { ...raw, permalink: undefined }
}

export async function createPublicSchedule(
  env: Env,
  raw: Record<string, unknown>,
  fingerprintFor: (value: string) => Promise<string>,
) {
  return publicSchedule(
    await createSchedule(
      env,
      { ...ordinaryScheduleInput(raw), note: '' },
      fingerprintFor,
    ),
  )
}

async function ordinarySchedule(
  env: Env,
  idValue: string,
  versionValue: unknown,
) {
  const version = versionFrom(versionValue)
  const original = await env.DB.prepare(
    'SELECT version,note,permalink FROM calendar_schedules WHERE id=? AND day IS NOT NULL',
  )
    .bind(idFrom(idValue))
    .first<Pick<CalendarSchedule, 'version' | 'note' | 'permalink'>>()
  if (original && original.version !== version)
    throw new CalendarError('calendar_conflict', 409)
  if (original?.permalink)
    throw new CalendarError('calendar_publication_read_only', 403)
  return original
}

export async function updatePublicSchedule(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  const input = ordinaryScheduleInput(raw)
  const original = await ordinarySchedule(env, idValue, raw.version)
  if (!original) throw new CalendarError('calendar_not_found', 404)
  // Staff-only notes remain unchanged; the shared form never receives them.
  return publicSchedule(
    await updateSchedule(env, idValue, { ...input, note: original.note }),
  )
}

export async function deletePublicSchedule(
  env: Env,
  idValue: string,
  raw: Record<string, unknown>,
) {
  await ordinarySchedule(env, idValue, raw.version)
  return deleteSchedule(env, idValue, raw)
}
