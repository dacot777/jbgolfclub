import { ArrowUpRight } from 'lucide-react'
import type { ReviewedAd } from '@/lib/reviewed-performance-types'

export default function ReviewedPostLinks({
  ads = [],
}: {
  ads?: ReviewedAd[]
}) {
  if (!ads.length) return null
  return (
    <section
      className="cc-reviewed-posts"
      aria-labelledby="ig-reviewed-heading"
    >
      <h2 id="ig-reviewed-heading">광고 보고서에 저장된 게시물</h2>
      <p>게시 월을 바꿔도 볼 수 있는 원문 링크입니다.</p>
      <ul>
        {ads.map((ad) => (
          <li key={ad.id}>
            <a href={ad.postUrl} target="_blank" rel="noopener noreferrer">
              {ad.thumbnailUrl && (
                <img
                  src={ad.thumbnailUrl}
                  alt=""
                  width="48"
                  height="48"
                  loading="lazy"
                />
              )}
              <span>{ad.title}</span>
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
