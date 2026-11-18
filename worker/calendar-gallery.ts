import {
  CALENDAR_ACCOUNTS,
  calendarOrganizationForAccount,
  type CalendarAccount,
  type CalendarKind,
  type CalendarMonth,
} from '../src/lib/calendar-types'
import {
  calendarAccountStatuses,
  calendarAccountStatusQuery,
} from './calendar-instagram'
import type { Env } from './types'

const PER_ACCOUNT = 9

// Normalize the canonical URLs stored by the collector and the link editor just
// as the permalink indexes do. One shortcode can have several Instagram URL forms.
function mediaKey(alias: string) {
  return `replace(replace(replace(${alias}.permalink,'/reel/','/p/'),'/reels/','/p/'),'/tv/','/p/')`
}
const linkKey = "replace(s.permalink,'/reel/','/p/')"

type GalleryRow = {
  media_id: string | null
  media_title: string
  media_kind: CalendarKind
  media_link: string
  has_cover: number
  link_id: string | null
  link_version: number
  link_title: string
  link_kind: CalendarKind
  link_url: string
  link_date: string
  link_time: string | null
  note: string
  date: string
  time: string | null
}

export async function latestCalendarPublications(
  env: Env,
  staff: boolean,
): Promise<CalendarMonth> {
  // Keep each account's newest nine, even when another account posts much more
  // frequently. Only staff registrations with a published permalink are eligible.
  const batch = env.DB.prepare(`
    WITH media AS MATERIALIZED (
      SELECT m.id, m.date, m.time FROM calendar_instagram_media m
      WHERE m.account=?1 AND m.id=(
        SELECT other.id FROM calendar_instagram_media other INDEXED BY calendar_media_link
        WHERE other.account=m.account AND ${mediaKey('other')}=${mediaKey('m')}
        ORDER BY other.date DESC,other.time DESC,other.id DESC LIMIT 1
      )
      ORDER BY m.date DESC,m.time DESC,m.id DESC LIMIT ?2
    ), links AS (
      SELECT s.id,s.day AS date,s.local_time AS time FROM calendar_schedules s
      WHERE s.account=?1 AND s.permalink IS NOT NULL
        AND s.day >= COALESCE((SELECT date FROM media ORDER BY date DESC,time DESC,id DESC LIMIT 1 OFFSET ?3),'')
        AND NOT EXISTS (
          SELECT 1 FROM calendar_instagram_media m
          WHERE m.account=s.account AND ${mediaKey('m')}=${linkKey}
        )
      ORDER BY s.day DESC,s.local_time DESC,s.id DESC LIMIT ?2
    ), newest AS (
      SELECT id,date,time,1 AS official FROM media
      UNION ALL
      SELECT id,date,time,0 AS official FROM links
      ORDER BY date DESC,time DESC,id DESC LIMIT ?2
    )
    SELECT newest.date,newest.time, m.id AS media_id,m.kind AS media_kind,m.title AS media_title,m.permalink AS media_link,
      (m.thumbnail_url IS NOT NULL OR m.use_album_child) AS has_cover,
      s.id AS link_id,s.version AS link_version,s.kind AS link_kind,s.title AS link_title,s.permalink AS link_url,
      s.day AS link_date,s.local_time AS link_time,
      ${staff ? 's.note' : "''"} AS note
    FROM newest LEFT JOIN calendar_instagram_media m ON newest.official=1 AND m.id=newest.id
    LEFT JOIN calendar_schedules s ON s.id=CASE WHEN newest.official=0 THEN newest.id ELSE (
      SELECT s.id FROM calendar_schedules s WHERE s.account=m.account AND s.permalink IS NOT NULL AND ${linkKey}=${mediaKey('m')}
    ) END
    ORDER BY newest.date DESC,newest.time DESC,newest.id DESC`)
  const [grants, ...groups] = await env.DB.batch([
    calendarAccountStatusQuery(env),
    ...CALENDAR_ACCOUNTS.map((account) =>
      batch.bind(account, PER_ACCOUNT, PER_ACCOUNT - 1),
    ),
  ])
  const data: CalendarMonth = {
    month: 'latest',
    accounts: calendarAccountStatuses(env, grants.results),
    schedules: [],
    posts: [],
  }
  for (const [index, group] of groups.entries()) {
    const account: CalendarAccount = CALENDAR_ACCOUNTS[index]
    for (const row of group.results as unknown as GalleryRow[]) {
      if (row.media_id) {
        data.posts.push({
          id: row.media_id,
          account,
          date: row.date,
          time: row.time ?? '',
          title: row.media_title,
          kind: row.media_kind,
          permalink: row.media_link,
          thumbnailUrl: row.has_cover
            ? '/api/calendar/thumbnail/' + row.media_id
            : null,
        })
      }
      if (row.link_id) {
        data.schedules.push({
          id: row.link_id,
          account,
          ...calendarOrganizationForAccount(account),
          date: row.link_date,
          time: row.link_time,
          title: row.link_title,
          kind: row.link_kind,
          version: row.link_version,
          permalink: row.link_url,
          note: row.note,
        })
      }
    }
  }
  return data
}
