import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const built = await build({
  entryPoints: ['worker/media-news.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const source = built.outputFiles[0].text
const script =
  source +
  `\nexport default { async fetch(request) {
  const kind = new URL(request.url).pathname;
  const body = await request.text();
  try {
    const result = kind === '/naver' ? await parseNaverNews(body, '테스트골프') : kind === '/bing' ? parseBingNews(body, '테스트골프') : await searchNews('테스트골프');
    return Response.json(result);
  } catch { return Response.json({error:'source_unavailable'}, {status:503}); }
} };`
function fixture(fetchMock) {
  return new Miniflare({
    modules: true,
    script,
    compatibilityDate: '2026-07-30',
    ...(fetchMock ? { fetchMock } : {}),
  })
}

test('뉴스 HTML은 주요 카드의 언론사·원문·사진을 연결하고 다른 언론사의 관련 기사는 건너뛴다', async () => {
  const f = fixture()
  try {
    const html = `<div id="main_pack">
      <span class="sds-comps-profile-info-title-text"><a>검증신문<span>새 창 열림</span></a></span>
      <a href="https://first.example/article/1" data-heatmap-target=".tit"><span class="sds-comps-text-type-headline1">테스트<mark>골프</mark> &amp; 첫 기사</span><span>새 창 열림</span></a>
      <a href="https://first.example/article/1" data-heatmap-target=".body">첫 기사 소개</a>
      <a href="https://first.example/article/1" data-heatmap-target=".img"><img src="https://search.pstatic.net/common/?src=https%3A%2F%2Fimages.example%2Fphoto.jpg&amp;type=face" /></a>
      <a href="https://related.example/article" data-heatmap-target=".tit"><span class="sds-comps-text-type-body2">다른 언론사의 관련 기사</span></a>
      <span class="sds-comps-profile-info-title-text">관련매체</span>
      <span class="sds-comps-profile-info-title-text">두번째신문</span>
      <a href="https://second.example/article/2" data-heatmap-target=".tit"><span class="sds-comps-text-type-headline1">두 번째 테스트골프 기사</span></a>
      <span class="sds-comps-profile-info-title-text">위험한 매체</span>
      <a href="https://127.0.0.1/private" data-heatmap-target=".tit"><span class="sds-comps-text-type-headline1">금지된 주소</span></a>
    </div>`
    const response = await f.dispatchFetch('https://worker.test/naver', {
      method: 'POST',
      body: html,
    })
    assert.equal(response.status, 200)
    const rows = await response.json()
    assert.equal(rows.length, 2)
    assert.equal(rows[0].publisher, '검증신문')
    assert.equal(rows[0].title, '테스트골프 & 첫 기사')
    assert.equal(rows[0].thumbnailUrl, 'https://images.example/photo.jpg')
    assert.equal(rows[0].searchText, '테스트골프 & 첫 기사 첫 기사 소개')
    assert.equal(rows[0].publishedAt, null)
    assert.equal(rows[1].publisher, '두번째신문')
    assert.deepEqual(rows[1].matchedKeywords, ['테스트골프'])
  } finally {
    await f.dispose()
  }
})

test('뉴스 RSS는 네임스페이스 언론사·사진과 원문 URL을 읽고 정확한 발행시각만 기록한다', async () => {
  const f = fixture()
  try {
    const xml = `<rss xmlns:News="https://search.example/"><channel><item>
      <title>검증 골프 &amp; 행사</title><link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Fpaper.example%2Fnews%3Fid%3D1&amp;ref=RSS</link>
      <description>테스트골프 소식</description><pubDate>Fri, 06 Nov 2026 01:00:00 GMT</pubDate>
      <News:Source>검증언론</News:Source><News:Image>https://images.example/thumb.jpg</News:Image>
    </item><item><title>안전하지 않은 링크</title><link>http://localhost/private</link></item></channel></rss>`
    const response = await f.dispatchFetch('https://worker.test/bing', {
      method: 'POST',
      body: xml,
    })
    assert.equal(response.status, 200)
    const rows = await response.json()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, '검증 골프 & 행사')
    assert.equal(rows[0].url, 'https://paper.example/news?id=1')
    assert.equal(rows[0].publisher, '검증언론')
    assert.equal(rows[0].thumbnailUrl, 'https://images.example/thumb.jpg')
    assert.equal(rows[0].publishedAt, '2026-11-06T01:00:00.000Z')
  } finally {
    await f.dispose()
  }
})

test('정상 검색 결과 없음과 원본 서비스 실패를 구분한다', async () => {
  const mock = createFetchMock()
  mock.disableNetConnect()
  mock
    .get('https://search.naver.com')
    .intercept({ path: /search\.naver/ })
    .reply(503, 'unavailable')
  mock
    .get('https://www.bing.com')
    .intercept({ path: /\/news\/search/ })
    .reply(503, 'unavailable')
  const f = fixture(mock)
  try {
    const empty = await f.dispatchFetch('https://worker.test/naver', {
      method: 'POST',
      body: '<div id="main_pack">검색 결과가 없습니다</div>',
    })
    assert.equal(empty.status, 200)
    assert.deepEqual(await empty.json(), [])
    const unavailable = await f.dispatchFetch('https://worker.test/search')
    assert.equal(unavailable.status, 503)
    const malformed = await f.dispatchFetch('https://worker.test/bing', {
      method: 'POST',
      body: '<html>정상 RSS가 아님</html>',
    })
    assert.equal(malformed.status, 503)
  } finally {
    await f.dispose()
  }
})
