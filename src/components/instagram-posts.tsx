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
  type CalendarSchedule,
} from '@/lib/calendar-types'
import type { CalendarPublication } from './content-calendar'
import '@/instagram-posts.css'

const accountsByName: Record<CalendarAccount, string> = {
  jbgolfacademy: '아카데미',
  jbgolfclub_official: '골프클럽 공식',
  jbgolfclub_bundang: '골프클럽 분당',
}

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

export default function InstagramPosts({
  posts,
  error,
  onRetry,
  onManage,
  onRegister,
  onEdit,
}: {
  posts: CalendarPublication[]
  error: string
  onRetry: () => void
  onManage?: () => void
  onRegister?: () => void
  onEdit?: (item: CalendarSchedule) => void
}) {
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
      <section className="ig-feed" aria-label="계정별 최신 피드">
        <h2>전체 계정</h2>
        <div className="ig-feeds">
          {CALENDAR_ACCOUNTS.map((account) => {
            const items = posts.filter(({ value }) => value.account === account)
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
                <div className="ig-profile-preview">
                  <iframe
                    src={'https://www.instagram.com/' + account + '/embed/'}
                    title={'@' + account + ' 인스타그램 피드 미리보기'}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <AccountLinks account={account} />
                {items.length > 0 && (
                  <>
                    <p className="ig-saved-heading">게시일이 확인된 피드</p>
                    <ul className="ig-post-grid">
                      {items.map((entry) => (
                        <Publication
                          key={entry.value.id}
                          entry={entry}
                          onEdit={onEdit}
                        />
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )
          })}
        </div>
        {error && (
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
