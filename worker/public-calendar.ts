import type { CalendarMonth } from '../src/lib/calendar-types'
import {
  calendarInstagramThumbnail,
  readCalendarMedia,
} from './calendar-instagram'
import {
  CalendarError,
  calendarMonth,
  listSchedules,
} from './calendar-schedules'
import type { Env } from './types'
import { latestCalendarPublications } from './calendar-gallery'

export const PUBLIC_THUMBNAIL_PATH = '/api/calendar/thumbnail/'

export async function loadCalendarMonth(
  request: Request,
  env: Env,
): Promise<CalendarMonth> {
  const month = calendarMonth(new URL(request.url).searchParams.get('month'))
  const [schedules, media] = await Promise.all([
    listSchedules(env, month),
    readCalendarMedia(env, month),
  ])
  return { month, schedules, ...media }
}

export async function readOnlyCalendarMonth(
  request: Request,
  env: Env,
  thumbnailPath: string,
): Promise<CalendarMonth> {
  const data = await loadCalendarMonth(request, env)
  return {
    month: data.month,
    schedules: data.schedules.map(
      ({
        id,
        version,
        account,
        brand,
        branch,
        kind,
        date,
        time,
        title,
        permalink,
      }) => ({
        id,
        version,
        account,
        brand,
        branch,
        kind,
        date,
        time,
        title,
        permalink,
        note: '',
      }),
    ),
    accounts: data.accounts.map(({ account, status, lastSyncedAt }) => ({
      account,
      status,
      lastSyncedAt,
    })),
    posts: data.posts.map(
      ({ id, account, kind, title, date, time, permalink, thumbnailUrl }) => ({
        id,
        account,
        kind,
        title,
        date,
        time,
        permalink,
        thumbnailUrl: thumbnailUrl ? thumbnailPath + id : null,
      }),
    ),
  }
}

export async function publicCalendar(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (request.method !== 'GET')
    return Response.json(
      { error: { code: 'method_not_allowed' } },
      { status: 405, headers: { Allow: 'GET' } },
    )
  try {
    if (path.startsWith(PUBLIC_THUMBNAIL_PATH))
      return await calendarInstagramThumbnail(
        env,
        path.slice(PUBLIC_THUMBNAIL_PATH.length),
      )
    const data =
      path === '/api/calendar/posts'
        ? await latestCalendarPublications(env, false)
        : await readOnlyCalendarMonth(request, env, PUBLIC_THUMBNAIL_PATH)
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const known = error instanceof CalendarError
    return Response.json(
      { error: { code: known ? error.code : 'calendar_unavailable' } },
      {
        status: known ? error.status : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
}
