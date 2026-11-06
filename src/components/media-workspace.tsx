import { useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  Clock3,
  ImageOff,
  LoaderCircle,
  Newspaper,
  Search,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useMediaFeed } from '@/lib/media-feed'
import {
  COMPANY_MEDIA_KEYWORDS,
  type MediaItem,
  type MediaKind,
} from '@/lib/media-types'
import '@/media-workspace.css'

function dateLabel(value: string | null, withTime = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(withTime
      ? {
          hour: '2-digit' as const,
          minute: '2-digit' as const,
          hourCycle: 'h23' as const,
        }
      : {}),
  }).format(new Date(value))
}

function MediaThumbnail({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="media-thumbnail">
      {item.thumbnailUrl && !failed ? (
        <img
          src={item.thumbnailUrl}
          alt={`${item.title} 썸네일`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="media-thumbnail-fallback">
          <ImageOff aria-hidden="true" />
          <span>이미지 없음</span>
        </span>
      )}
    </div>
  )
}

function MediaArticle({ item, kind }: { item: MediaItem; kind: MediaKind }) {
  const Icon = kind === 'news' ? Newspaper : BookOpen
  const published = dateLabel(item.publishedAt)
  return (
    <article className="media-card" aria-label={item.title}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${item.publisher} · ${item.title} 원문 보기`}
      >
        <MediaThumbnail
          key={`${item.id}:${item.thumbnailUrl ?? ''}`}
          item={item}
        />
        <div className="media-card-body">
          <div className="media-publisher">
            <Icon size={14} aria-hidden="true" />
            <strong title={item.publisher}>{item.publisher}</strong>
            <ArrowUpRight size={15} aria-hidden="true" />
          </div>
          {kind === 'blog' && item.author && item.author !== item.publisher && (
            <p className="media-author">{item.author}</p>
          )}
          <h2>{item.title}</h2>
          <div className="media-card-bottom">
            <span className="media-published">
              <Clock3 size={12} aria-hidden="true" />
              {published ? (
                <time dateTime={item.publishedAt!}>{published}</time>
              ) : (
                '게시일 미확인'
              )}
            </span>
          </div>
          {item.matchedKeywords.length > 0 && (
            <ul className="media-matches" aria-label="관련 키워드">
              {item.matchedKeywords.map((keyword) => (
                <li key={keyword}>{keyword}</li>
              ))}
            </ul>
          )}
        </div>
      </a>
    </article>
  )
}

export default function MediaWorkspace({ kind }: { kind: MediaKind }) {
  const { data, loading, checking, error } = useMediaFeed(kind)
  const isNews = kind === 'news'
  const label = isNews ? '기사' : '블로그'
  const Icon = isNews ? Newspaper : BookOpen
  const items = data?.items ?? []
  const keywords = data?.keywords.length
    ? data.keywords
    : COMPANY_MEDIA_KEYWORDS
  const checked = dateLabel(data?.checkedAt ?? data?.updatedAt ?? null, true)
  const unavailable = Boolean(
    error || (!checking && data?.status === 'unavailable'),
  )
  const partial = data?.status === 'partial'

  return (
    <div className="media-workspace" id={kind}>
      <section className="page-heading">
        <div>
          <p className="eyebrow">JB GOLF · MEDIA WORKSPACE</p>
          <h1>
            {label}
            <span>.</span>
          </h1>
          <p className="page-description">
            {isNews
              ? 'JB골프아카데미와 JB골프클럽의 언론 보도를 한눈에 확인하세요.'
              : '공식 소식부터 이용 후기까지, 우리 회사에 관한 공개 블로그 글을 모아봅니다.'}
          </p>
        </div>
        <div className="media-check-state" role="status">
          {checking ? (
            <>
              <LoaderCircle
                className="media-spinning"
                size={15}
                aria-hidden="true"
              />
              {data?.refreshing
                ? `키워드 확인 중 · ${data.successfulQueries}/${data.totalQueries}`
                : '최신 목록 확인 중'}
            </>
          ) : checked ? (
            <>
              <Clock3 size={14} aria-hidden="true" />
              최근 확인 {checked}
            </>
          ) : (
            <>
              <Icon size={15} aria-hidden="true" />
              메뉴를 열면 자동 확인
            </>
          )}
        </div>
      </section>

      <section
        className="media-keyword-panel"
        aria-labelledby="media-keyword-title"
      >
        <div>
          <Search size={16} aria-hidden="true" />
          <h2 id="media-keyword-title">모니터링 키워드</h2>
          <span>{keywords.length}개</span>
        </div>
        <ul aria-label="모니터링 키워드">
          {keywords.map((keyword) => (
            <li key={keyword}>{keyword}</li>
          ))}
        </ul>
      </section>

      {(unavailable || partial) && (
        <div className="media-feed-notice" role="status">
          {items.length
            ? unavailable
              ? '최신 검색 연결이 지연되어 최근 확인한 글을 표시합니다.'
              : '일부 검색이 지연되고 있습니다. 확인된 글부터 표시합니다.'
            : unavailable
              ? '검색 연결이 잠시 지연되고 있습니다. 다음에 이 메뉴를 열면 다시 확인합니다.'
              : '검색 결과를 확인하는 중입니다.'}
        </div>
      )}

      <section
        className="media-results"
        aria-label={`${label} 목록`}
        aria-busy={loading || checking}
      >
        <div className="media-results-heading">
          <h2>
            <Icon size={18} aria-hidden="true" />
            관련 {label}
          </h2>
          {data && <span>{items.length}개 글</span>}
        </div>
        {items.length > 0 ? (
          <div className="media-grid">
            {items.map((item) => (
              <MediaArticle key={item.id} item={item} kind={kind} />
            ))}
          </div>
        ) : loading || checking ? (
          <div className="media-empty" role="status">
            <LoaderCircle
              className="media-spinning"
              size={28}
              aria-hidden="true"
            />
            <h2>관련 {label}를 확인하고 있습니다</h2>
            <p>키워드별로 찾은 글이 이곳에 표시됩니다.</p>
          </div>
        ) : unavailable ? (
          <div className="media-empty">
            <Icon size={32} aria-hidden="true" />
            <h2>{label} 목록을 잠시 불러오지 못했습니다</h2>
            <p>검색 연결이 정상화되면 메뉴를 열 때 자동으로 확인합니다.</p>
          </div>
        ) : (
          <Card className="media-empty">
            <Search size={32} aria-hidden="true" />
            <h2>아직 관련 {label}를 찾지 못했습니다</h2>
            <p>공개 검색에 새로운 글이 확인되면 목록에 반영합니다.</p>
          </Card>
        )}
      </section>
      <footer className="media-footer">
        <span>JB GOLF ACADEMY & CLUB</span>
        <p>
          공개 검색에 노출된 글을 모으며, 게시물은 원문에서 확인할 수 있습니다.
        </p>
      </footer>
    </div>
  )
}
