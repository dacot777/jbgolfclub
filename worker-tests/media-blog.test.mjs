import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { Miniflare, createFetchMock } from 'miniflare'

const bundle = await build({
  stdin: {
    contents: `import {parseBlogSearch,searchBlogs} from './worker/media-blog.ts';
      export default { async fetch(request) { try {const result=new URL(request.url).pathname==='/parse'
        ? await parseBlogSearch(new Response(await request.text())) : await searchBlogs('JB골프클럽');
        return Response.json(result)} catch (error) {return Response.json({error:String(error)},{status:503})} } }`,
    resolveDir: process.cwd(),
    sourcefile: 'blog-test-worker.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})

function card({
  id = 'customer-test',
  post = '1234567890',
  title = 'JB<mark>골프</mark>클럽 합성 이용 후기',
  snippet = '실제 고객이 작성한 것으로 가정한 합성 리뷰입니다.',
  date = '2026. 01. 05.',
  image = 'https://img.example.com/post.png',
  publisher = '독자 테스트 블로그',
} = {}) {
  const url = `https://blog.naver.com/${id}/${post}`
  return `<div data-template-id="ugcItem"><a href="https://blog.naver.com/${id}" data-heatmap-target="articleSourceJSX_title"><span>${publisher}</span><span>새 창 열림</span><img src="https://img.example.com/avatar.png"></a>
    <span class="sds-comps-profile-info-subtext">${date}</span>
    <a href="${url}?utm_source=test"><span class="sds-comps-text-type-headline1">${title}</span></a>
    <a href="${url}"><span class="sds-comps-text-type-body1">${snippet}</span></a>
    <a href="${url}"><img src="${image}"></a></div>`
}

function fixture() {
  const fetchMock = createFetchMock()
  fetchMock.disableNetConnect()
  const mf = new Miniflare({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-07-30',
    fetchMock,
  })
  return { mf, fetchMock }
}

test('공개 블로그 카드에서 개인 후기·게시물 제목·블로그명·실제 썸네일을 읽고 중복을 제거한다', async () => {
  const { mf } = fixture()
  try {
    const html = `<html><head><title>블로그검색</title></head><body>${card({ title: 'JB<mark>골프</mark>클럽 &amp; 합성 이용 후기', image: 'https://img.example.com/post.png?a=1&amp;b=2' })}${card()}${card({ id: 'official-test', post: '1234567891', publisher: 'JB골프클럽 합성 공식 블로그', title: 'JB골프클럽 합성 공지' })}</body></html>`
    const response = await mf.dispatchFetch('https://test.local/parse', {
      method: 'POST',
      body: html,
    })
    assert.equal(response.status, 200, await response.clone().text())
    const items = await response.json()
    assert.equal(items.length, 2)
    assert.equal(items[0].title, 'JB골프클럽 & 합성 이용 후기')
    assert.equal(
      items[0].url,
      'https://blog.naver.com/customer-test/1234567890',
    )
    assert.equal(items[0].publisher, '독자 테스트 블로그')
    assert.equal(items[0].author, null)
    assert.equal(
      items[0].thumbnailUrl,
      'https://img.example.com/post.png?a=1&b=2',
    )
    assert.equal(items[0].publishedAt, '2026-01-05')
    assert.ok(items[0].matchedKeywords.includes('JB골프클럽'))
    assert.match(items[0].searchText, /합성 리뷰/)
  } finally {
    await mf.dispose()
  }
})

test('검색 성공의 빈 결과와 차단·깨진 형식·HTTP 실패를 구분한다', async () => {
  const { mf, fetchMock } = fixture()
  try {
    const empty = await mf.dispatchFetch('https://test.local/parse', {
      method: 'POST',
      body: '<html><title>블로그검색</title><div id="notfound">검색결과가 없습니다.</div></html>',
    })
    assert.equal(empty.status, 200)
    assert.deepEqual(await empty.json(), [])
    for (const html of [
      '<html><title>보안 확인</title></html>',
      '<html><title>새로운 검색 형식</title></html>',
    ]) {
      const response = await mf.dispatchFetch('https://test.local/parse', {
        method: 'POST',
        body: html,
      })
      assert.equal(response.status, 503)
    }
    fetchMock
      .get('https://search.naver.com')
      .intercept({ path: /^\/search\.naver\?/ })
      .reply(503, 'unavailable')
    const response = await mf.dispatchFetch('https://test.local/search')
    assert.equal(response.status, 503)
  } finally {
    await mf.dispose()
  }
})

test('상대 날짜를 수집 시각으로 바꾸지 않고 공개 모바일 메타데이터가 있을 때만 보완한다', async () => {
  const { mf, fetchMock } = fixture()
  try {
    fetchMock
      .get('https://search.naver.com')
      .intercept({ path: /^\/search\.naver\?/ })
      .reply(200, `<title>블로그검색</title>${card({ date: '1일 전' })}`, {
        headers: { 'Content-Type': 'text/html' },
      })
    fetchMock
      .get('https://m.blog.naver.com')
      .intercept({ path: '/customer-test/1234567890' })
      .reply(
        200,
        `<html><head><meta property="og:url" content="https://blog.naver.com/customer-test/1234567890"><meta property="og:article:author" content="독자 테스터 | 블로그"></head><body><div id="_post_property" addDate="1767571200000" blogName="독자 테스트 블로그"></div></body></html>`,
        { headers: { 'Content-Type': 'text/html' } },
      )
    const response = await mf.dispatchFetch('https://test.local/search')
    assert.equal(response.status, 200, await response.clone().text())
    const [item] = await response.json()
    assert.equal(item.author, '독자 테스터')
    assert.equal(item.publishedAt, '2026-01-05T00:00:00.000Z')
    assert.equal(item.thumbnailUrl, 'https://img.example.com/post.png')
  } finally {
    await mf.dispose()
  }
})

test('유사 검색의 무관한 글·사설 주소·가짜 이미지와 단순 학원명을 노출하지 않는다', async () => {
  const { mf } = fixture()
  try {
    const html = `<title>블로그검색</title>${card({ title: 'JB금융 합성 주식 글', snippet: '골프와 무관한 금융 결과', publisher: '주식 블로그' })}${card({ title: 'JB ACADEMY 수학 학원', snippet: '수학 공부법', publisher: '학원 블로그' })}${card({ post: '1234567892', image: 'http://127.0.0.1/private.png' })}`
    const response = await mf.dispatchFetch('https://test.local/parse', {
      method: 'POST',
      body: html,
    })
    assert.equal(response.status, 200)
    const items = await response.json()
    assert.equal(items.length, 1)
    assert.equal(items[0].thumbnailUrl, null)
    assert.equal(items[0].publishedAt, '2026-01-05')
  } finally {
    await mf.dispose()
  }
})
