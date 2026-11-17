import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchNews, type NewsSearchRequest } from './tavily'

const request: NewsSearchRequest = {
  query: 'sample senate budget',
  domains: ['apnews.com', 'npr.org'],
  startDate: '2026-09-24',
  endDate: '2026-10-01',
}

const fetchMock = vi.fn<typeof fetch>()

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TAVILY_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('searchNews', () => {
  it('searches news on the given outlets and dates, and maps the results', async () => {
    fetchMock.mockResolvedValueOnce(
      respond(200, {
        results: [
          {
            title: 'Sample budget clears Senate',
            url: 'https://apnews.com/article/sample-budget-senate-abc123',
            content: 'Invented body text that must not be passed on.',
            score: 0.91,
            published_date: 'Sat, 26 Sep 2026 14:03:11 GMT',
          },
          { title: 'Undated sample page', url: 'https://www.npr.org/2026/09/26/nx-s1-1/sample-budget' },
          { title: 'A result with no link' },
          null,
        ],
      }),
    )

    expect(await searchNews(request)).toEqual({
      ok: true,
      value: [
        {
          title: 'Sample budget clears Senate',
          url: 'https://apnews.com/article/sample-budget-senate-abc123',
          publishedAt: '2026-09-26T14:03:11.000Z',
          score: 0.91,
        },
        {
          title: 'Undated sample page',
          url: 'https://www.npr.org/2026/09/26/nx-s1-1/sample-budget',
          publishedAt: null,
          score: 0,
        },
      ],
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'sample senate budget',
      topic: 'news',
      search_depth: 'basic',
      max_results: 20,
      include_domains: ['apnews.com', 'npr.org'],
      start_date: '2026-09-24',
      end_date: '2026-10-01',
    })
  })

  it('does not call the API without a key', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')

    expect(await searchNews(request)).toEqual({ ok: false, failure: 'missing-key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'unauthorized'],
    [429, 'rate-limited'],
    [432, 'quota'],
    [500, 'unavailable'],
  ])('reports HTTP %i as %s', async (status, failure) => {
    fetchMock.mockResolvedValueOnce(respond(status, { detail: { error: 'invented error' } }))

    expect(await searchNews(request)).toEqual({ ok: false, failure })
  })

  it('reports unavailable when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))

    expect(await searchNews(request)).toEqual({ ok: false, failure: 'unavailable' })
  })
})
