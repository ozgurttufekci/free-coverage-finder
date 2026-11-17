import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupNytArticle } from './nyt-api'
import { parseNytLink } from './nyt-url'

const ARTICLE = 'https://www.nytimes.com/2026/09/26/us/politics/sample-senate-budget-vote.html'

const doc = {
  web_url: ARTICLE,
  abstract: 'An invented summary of the sample story.',
  snippet: 'An invented snippet.',
  headline: { main: 'Senate Passes Sample Budget After Late Vote', print_headline: 'Sample Budget Passes' },
  byline: { original: 'By Jordan Example' },
  pub_date: '2026-09-26T09:02:15+0000',
  section_name: 'U.S.',
  type_of_material: 'News',
  keywords: [
    { name: 'subject', value: 'Federal Budget (US)', rank: 2 },
    { name: 'persons', value: 'Rivera, Morgan', rank: 1 },
    { name: 'Organization', value: 'Senate', rank: 3 },
    { name: 'glocations', value: 'Washington (DC)', rank: 4 },
  ],
}

const fetchMock = vi.fn<typeof fetch>()

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status })
}

function requested(call: number) {
  return new URL(String(fetchMock.mock.calls[call][0]))
}

function lookup() {
  const parsed = parseNytLink(ARTICLE)
  if (!parsed.ok) throw new Error(parsed.message)
  return lookupNytArticle(parsed.link)
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('NYT_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

describe('lookupNytArticle', () => {
  it('finds the article by its URL and maps the fields', async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { response: { docs: [doc] } }))

    expect(await lookup()).toEqual({
      ok: true,
      value: {
        url: ARTICLE,
        headline: 'Senate Passes Sample Budget After Late Vote',
        summary: 'An invented summary of the sample story.',
        byline: 'By Jordan Example',
        publishedAt: '2026-09-26T09:02:15.000Z',
        section: 'U.S.',
        materialType: 'News',
        tags: [
          { kind: 'person', value: 'Rivera, Morgan' },
          { kind: 'subject', value: 'Federal Budget (US)' },
          { kind: 'organization', value: 'Senate' },
          { kind: 'location', value: 'Washington (DC)' },
        ],
      },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(requested(0).origin + requested(0).pathname).toBe(
      'https://api.nytimes.com/svc/search/v2/articlesearch.json',
    )
    expect(requested(0).searchParams.get('fq')).toBe(`url:"${ARTICLE}"`)
    expect(requested(0).searchParams.get('api-key')).toBe('test-key')
  })

  it('searches by the link words and date when the URL filter returns another article', async () => {
    const other = { ...doc, web_url: 'https://www.nytimes.com/2026/09/26/us/another-sample-story.html' }
    fetchMock
      .mockResolvedValueOnce(respond(200, { response: { docs: [other] } }))
      .mockResolvedValueOnce(respond(200, { response: { docs: [other, { ...doc, abstract: '' }] } }))

    expect(await lookup()).toMatchObject({
      ok: true,
      value: { headline: 'Senate Passes Sample Budget After Late Vote', summary: 'An invented snippet.' },
    })
    expect(requested(1).searchParams.get('q')).toBe('sample senate budget vote')
    expect(requested(1).searchParams.get('begin_date')).toBe('20260925')
    expect(requested(1).searchParams.get('end_date')).toBe('20260927')
  })

  it('reports not-found when neither query returns the requested article', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(400, { fault: 'invalid filter' }))
      .mockResolvedValueOnce(respond(200, { response: { docs: [] } }))

    expect(await lookup()).toEqual({ ok: false, failure: 'not-found' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not call the API without a key', async () => {
    vi.stubEnv('NYT_API_KEY', '')

    expect(await lookup()).toEqual({ ok: false, failure: 'missing-key' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [401, 'unauthorized'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
  ])('stops at HTTP %i and reports %s', async (status, failure) => {
    fetchMock.mockResolvedValueOnce(respond(status))

    expect(await lookup()).toEqual({ ok: false, failure })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    expect(await lookup()).toEqual({ ok: false, failure: 'unavailable' })
  })
})
