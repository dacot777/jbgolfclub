import { useState } from 'react'
import {
  ArrowUpRight,
  Clapperboard,
  Image as ImageIcon,
  Link2,
  Pencil,
} from 'lucide-react'
import {
  CALENDAR_ACCOUNTS,
  type CalendarAccount,
  type CalendarAccountStatus,
  type CalendarSchedule,
} from '@/lib/calendar-types'
import type { ReviewedAd } from '@/lib/reviewed-performance-types'
import { parseCalendarPermalink } from '@/lib/calendar-permalink'
import type { CalendarPublication } from './content-calendar'
import ReviewedPostLinks from './reviewed-post-links'
import '@/instagram-posts.css'

type Filter = CalendarAccount | 'all'
const names: Record<CalendarAccount, string> = {
  jbgolfacademy: '아카데미',
  jbgolfclub_official: '골프클럽 공식',
  jbgolfclub_bundang: '골프클럽 분당',
}
const states: Record<CalendarAccountStatus['status'], string> = {
  connected: '연결됨',
  needs_connection: '자동 수집 연결 전',
  setup_required: '자동 수집 연결 전',
  syncing: '게시물 수집 중',
  error: '동기화 확인 필요',
}

function AccountLinks({
  accounts,
  filter,
}: {
  accounts: CalendarAccountStatus[]
  filter: Filter
}) {
  return (
    <nav aria-label="계정별 게시물과 릴스 바로가기" className="ig-profiles">
      <h2>계정별 원문 찾기</h2>
      <div className="cc-account-links">
        {(filter === 'all' ? CALENDAR_ACCOUNTS : [filter]).map((account) => {
          const profile = 'https://www.instagram.com/' + account + '/'
          const search = new URL('https://search.naver.com/search.naver')
          search.searchParams.set(
            'query',
            'site:instagram.com "' + account + '"',
          )
          const status = accounts.find((a) => a.account === account)?.status
          return (
            <div key={account}>
              <span className="ig-profile-handle">@{account}</span>
              {status && (
                <span className="cc-link-account">{states[status]}</span>
              )}
              <div className="cc-link-options">
                {[
                  ['게시물', profile],
                  ['릴스', profile + 'reels/'],
                  ['네이버 검색', search.href],
                ].map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={names[account] + ' ' + label + ' (새 창)'}
                  >
                    {label}
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </nav>
  )
}

function Publication({
  entry,
  onEdit,
}: {
  entry: CalendarPublication
  onEdit?: (item: CalendarSchedule) => void
}) {
  const [failed, setFailed] = useState('')
  const post = entry.value
  const ThumbnailIcon = post.kind === 'reel' ? Clapperboard : ImageIcon
  const registration = entry.registration
  return (
    <li className="ig-publication">
      <a
        href={post.permalink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={post.title + ' Instagram에서 보기'}
      >
        <div className="ig-image">
          {post.thumbnailUrl && post.thumbnailUrl !== failed ? (
            <img
              src={post.thumbnailUrl}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              alt=""
              onError={() => setFailed(post.thumbnailUrl ?? '')}
            />
          ) : (
            <div className="ig-no-image">
              <ThumbnailIcon size={24} aria-hidden="true" />
              <span>미리보기 없음</span>
            </div>
          )}
          <span className="ig-kind">
            <ThumbnailIcon size={13} aria-hidden="true" />
            {post.kind === 'reel' ? '릴스' : '게시물'}
          </span>
        </div>
        <div className="ig-caption">
          <span className="ig-by">@{post.account}</span>
          <h3>
            {post.title}
            <ArrowUpRight size={16} aria-hidden="true" />
          </h3>
          <p>
            <time
              dateTime={
                post.time
                  ? post.date + 'T' + post.time + ':00+09:00'
                  : post.date
              }
            >
              {post.date.replaceAll('-', '.')} {post.time}
            </time>{' '}
            · {entry.source === 'manual' ? '직접 등록' : 'Instagram'}
          </p>
        </div>
      </a>
      {onEdit && registration && (
        <button
          className="ig-edit"
          type="button"
          aria-label={post.title + ' 링크 수정'}
          onClick={() => onEdit(registration)}
        >
          <Pencil size={13} aria-hidden="true" />
          링크 수정
        </button>
      )}
    </li>
  )
}

export default function InstagramPosts({
  month,
  onMonthChange,
  filter,
  onFilterChange,
  posts,
  accounts,
  reviewedAds = [],
  loading,
  error,
  onRetry,
  onManage,
  onRegister,
  onEdit,
}: {
  month: string
  onMonthChange: (month: string) => void
  filter: Filter
  onFilterChange: (filter: Filter) => void
  posts: CalendarPublication[]
  accounts: CalendarAccountStatus[]
  reviewedAds?: ReviewedAd[]
  loading: boolean
  error: string
  onRetry: () => void
  onManage?: () => void
  onRegister?: () => void
  onEdit?: (item: CalendarSchedule) => void
}) {
  const [year, m] = month.split('-')
  const displayed = new Set(
    posts
      .filter(({ value }) => value.account === 'jbgolfacademy')
      .map(
        ({ value }) =>
          parseCalendarPermalink(value.permalink, value.account)?.shortcode,
      ),
  )
  const otherReviewed = reviewedAds.filter(({ postUrl }) => {
    const code = parseCalendarPermalink(postUrl, 'jbgolfacademy')?.shortcode
    return code && !displayed.has(code)
  })
  const selectedAccounts = accounts.filter(
    ({ account }) => filter === 'all' || account === filter,
  )
  const awaitingConnection = selectedAccounts.some(
    ({ status }) =>
      status === 'setup_required' || status === 'needs_connection',
  )
  return (
    <div className="ig-gallery">
      <header className="cc-header">
        <h1 id="ig-gallery-title">인스타 게시물 모아보기</h1>
        <div className="cc-header-actions">
          {onManage && (
            <button type="button" className="cc-manage" onClick={onManage}>
              계정 관리
            </button>
          )}
          {onRegister && (
            <button type="button" className="cc-primary" onClick={onRegister}>
              <Link2 size={16} aria-hidden="true" />
              게시물 링크 등록
            </button>
          )}
        </div>
      </header>
      <div className="ig-toolbar">
        <div className="cc-filter" role="group" aria-label="표시할 계정">
          {(['all', ...CALENDAR_ACCOUNTS] as const).map((account) => (
            <button
              key={account}
              type="button"
              aria-pressed={filter === account}
              onClick={() => onFilterChange(account)}
            >
              {account === 'all' ? '전체 계정' : names[account]}
            </button>
          ))}
        </div>
        <label>
          게시 월{' '}
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value))
                onMonthChange(e.target.value)
            }}
          />
        </label>
      </div>
      <section
        className="ig-month-section"
        aria-labelledby="ig-month-heading"
        aria-busy={loading}
      >
        <h2 id="ig-month-heading">
          {year}년 {Number(m)}월 게시물·릴스
        </h2>
        {error ? (
          <p role="alert">
            {error}{' '}
            <button type="button" className="cc-text" onClick={onRetry}>
              다시 불러오기
            </button>
          </p>
        ) : loading ? (
          <p role="status">게시물을 불러오는 중입니다.</p>
        ) : posts.length ? (
          <ul className="ig-post-grid">
            {posts.map((entry) => (
              <Publication
                key={entry.value.account + '/' + entry.value.id}
                entry={entry}
                onEdit={onEdit}
              />
            ))}
          </ul>
        ) : (
          <p className="ig-empty">
            이달에 수집하거나 직접 등록한 게시물이 없습니다.
            {awaitingConnection &&
              ' 자동 수집 연결 전에도 아래에서 계정별 원문을 열어볼 수 있습니다.'}
          </p>
        )}
      </section>
      {(filter === 'all' || filter === 'jbgolfacademy') && (
        <ReviewedPostLinks ads={otherReviewed} />
      )}
      <AccountLinks filter={filter} accounts={accounts} />
    </div>
  )
}
