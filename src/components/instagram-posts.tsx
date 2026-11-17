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
import type { CalendarPublication } from './content-calendar'
import '@/instagram-posts.css'

type Filter = CalendarAccount | 'all'
const accountsByName: Record<CalendarAccount, string> = {
  jbgolfacademy: '아카데미',
  jbgolfclub_official: '골프클럽 공식',
  jbgolfclub_bundang: '골프클럽 분당',
}
const overviewLimit = 3

function AccountLinks({ account }: { account: CalendarAccount }) {
  const profile = 'https://www.instagram.com/' + account + '/'
  const search = new URL('https://search.naver.com/search.naver')
  search.searchParams.set('query', 'site:instagram.com "' + account + '"')
  return (
    <nav
      className="ig-originals"
      aria-label={accountsByName[account] + ' 원문 바로가기'}
    >
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
          aria-label={accountsByName[account] + ' ' + label + ' (새 창)'}
        >
          {label}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      ))}
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
  const MediaIcon = post.kind === 'reel' ? Clapperboard : ImageIcon
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
              <MediaIcon size={24} aria-hidden="true" />
              <span>미리보기 없음</span>
            </div>
          )}
          <span className="ig-kind">
            <MediaIcon size={13} aria-hidden="true" />
            {post.kind === 'reel' ? '릴스' : '피드'}
          </span>
        </div>
        <div className="ig-caption">
          <p>
            <time
              dateTime={
                post.time
                  ? post.date + 'T' + post.time + ':00+09:00'
                  : post.date
              }
            >
              {post.date.replaceAll('-', '.')} {post.time}
            </time>
            {entry.source === 'manual' && ' · 직접 등록'}
          </p>
          <h4>{post.title}</h4>
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

function emptyFeedMessage(
  status: CalendarAccountStatus['status'] | undefined,
  month: string,
) {
  if (status === 'error')
    return '동기화 상태를 확인해 주세요. 인스타그램에서 원문을 볼 수 있습니다.'
  if (status === 'syncing') return '이 계정의 게시물을 가져오고 있습니다.'
  if (status === 'setup_required' || status === 'needs_connection')
    return '자동 수집 연결 전입니다. 인스타그램에서 피드를 열어보세요.'
  return month
    ? '이 달에 수집하거나 등록한 게시물이 없습니다.'
    : '아직 수집하거나 등록한 게시물이 없습니다.'
}

export default function InstagramPosts({
  month,
  onMonthChange,
  filter,
  onFilterChange,
  posts,
  accounts,
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
  loading: boolean
  error: string
  onRetry: () => void
  onManage?: () => void
  onRegister?: (account?: CalendarAccount) => void
  onEdit?: (item: CalendarSchedule) => void
}) {
  const [lastMonth, setLastMonth] = useState(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .slice(0, 7),
  )
  const [year, m] = month.split('-')
  const selected = filter === 'all' ? CALENDAR_ACCOUNTS : [filter]
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
            <button
              type="button"
              className="cc-primary"
              onClick={() => onRegister(filter === 'all' ? undefined : filter)}
            >
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
              {account === 'all' ? '전체 계정' : accountsByName[account]}
            </button>
          ))}
        </div>
        <div className="ig-period">
          <div className="cc-filter" role="group" aria-label="조회 기간">
            <button
              type="button"
              aria-pressed={!month}
              onClick={() => onMonthChange('')}
            >
              최신 피드
            </button>
            <button
              type="button"
              aria-pressed={Boolean(month)}
              onClick={() => onMonthChange(month || lastMonth)}
            >
              월별 보기
            </button>
          </div>
          {month && (
            <label>
              게시 월
              <input
                type="month"
                value={month}
                onChange={(e) => {
                  const value = e.target.value
                  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
                    setLastMonth(value)
                    onMonthChange(value)
                  }
                }}
              />
            </label>
          )}
        </div>
      </div>
      <section
        className="ig-feed"
        aria-labelledby="ig-feed-heading"
        aria-busy={Boolean(month && loading)}
      >
        <h2 id="ig-feed-heading">
          {month
            ? year + '년 ' + Number(m) + '월 게시물·릴스'
            : '계정별 최신 피드'}
        </h2>
        {month && error && (
          <p className="ig-feedback" role="alert">
            {error}{' '}
            <button type="button" className="cc-text" onClick={onRetry}>
              다시 불러오기
            </button>
          </p>
        )}
        {month && loading && !error && (
          <p className="ig-feedback" role="status">
            게시물을 불러오는 중입니다.
          </p>
        )}
        <div className="ig-feeds" data-overview={filter === 'all'}>
          {selected.map((account) => {
            const items = posts.filter(({ value }) => value.account === account)
            const visible =
              filter === 'all' ? items.slice(0, overviewLimit) : items
            return (
              <section
                key={account}
                className="ig-account"
                aria-labelledby={'ig-account-' + account}
              >
                <header className="ig-account-head">
                  <h3 id={'ig-account-' + account}>
                    {accountsByName[account]}
                  </h3>
                  <span>@{account}</span>
                </header>
                {!month && (
                  <div className="ig-profile-preview">
                    <iframe
                      key={account}
                      src={'https://www.instagram.com/' + account + '/embed/'}
                      title={'@' + account + ' 인스타그램 피드 미리보기'}
                      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
                {!month && <AccountLinks account={account} />}
                {!month && visible.length > 0 && (
                  <p className="ig-saved-heading">게시일이 확인된 피드</p>
                )}
                {visible.length ? (
                  <ul className="ig-post-grid">
                    {visible.map((entry) => (
                      <Publication
                        key={entry.value.id}
                        entry={entry}
                        onEdit={onEdit}
                      />
                    ))}
                  </ul>
                ) : (
                  month &&
                  !loading &&
                  !error && (
                    <div className="ig-empty">
                      <p>
                        {emptyFeedMessage(
                          accounts.find((row) => row.account === account)
                            ?.status,
                          month,
                        )}
                      </p>
                      {onRegister && (
                        <button
                          type="button"
                          className="cc-text"
                          onClick={() => onRegister(account)}
                          aria-label={accountsByName[account] + ' 게시물 등록'}
                        >
                          <Link2 size={14} aria-hidden="true" />
                          게시물 등록
                        </button>
                      )}
                    </div>
                  )
                )}
                {items.length > visible.length && (
                  <button
                    className="ig-more"
                    type="button"
                    onClick={() => onFilterChange(account)}
                    aria-label={accountsByName[account] + ' 게시물 더 보기'}
                  >
                    게시물 더 보기
                  </button>
                )}
                {month && <AccountLinks account={account} />}
              </section>
            )
          })}
        </div>
        {!month && error && (
          <p className="ig-feedback" role="alert">
            등록한 게시물을 불러오지 못했습니다.{' '}
            <button type="button" className="cc-text" onClick={onRetry}>
              다시 불러오기
            </button>
          </p>
        )}
      </section>
    </div>
  )
}
