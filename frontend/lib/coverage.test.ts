import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findCoverage, type CoverageDeps } from './coverage'
import type { NytArticle } from './nyt-api'
import { parseNytLink } from './nyt-url'
import type { NewsResult } from './tavily'
import { failed, found } from './upstream'

const ARTICLE = 'https://www.nytimes.com/2026/09/26/us/politics/sample-senate-budget-vote.html'
const TODAY = '2026-11-16'

const article: NytArticle = {
  url: ARTICLE,
  headline: 'Rivera Pushes Sample Budget Through Senate',
  summary: 'An invented summary of the sample story.',
  byline: 'By Jordan Example',
  publishedAt: '2026-09-26T09:02:15.000Z',
  section: 'U.S.',
  materialType: 'News',
  tags: [
    { kind: 'person', value: 'Rivera, Morgan' },
    { kind: 'subject', value: 'Federal Budget (US)' },
    { kind: 'person', value: 'Okafor, Dana R (1970- )' },
    { kind: 'person', value: 'Lindqvist, Per' },
  ],
}

function result(url: string, title: string): NewsResult {
  return { url, title, publishedAt: '2026-09-26T15:00:00.000Z', score: 0.7 }
}

const ap = result('https://apnews.com/article/senate-sample-budget-vote-abc123', 'Senate passes sample budget in late vote | AP News')
const npr = result('https://www.npr.org/2026/09/26/nx-s1-1/senate-budget-vote-explained', 'What is in the Senate budget vote : NPR')
const hill = result('https://thehill.com/homenews/senate/5512345-budget-vote-reaction/', 'Senate budget vote draws swift reaction | The Hill')

const lookupArticle = vi.fn<CoverageDeps['lookupArticle']>()
const searchNews = vi.fn<CoverageDeps['searchNews']>()

function find(today = TODAY) {
  const parsed = parseNytLink(ARTICLE)
  if (!parsed.ok) throw new Error(parsed.message)
  return findCoverage(parsed.link, { lookupArticle, searchNews, today })
}

beforeEach(() => {
  lookupArticle.mockReset().mockResolvedValue(found(article))
  searchNews.mockReset().mockResolvedValue(found([ap, npr, hill]))
})

describe('findCoverage', () => {
  it('returns the NYT story, ranked free coverage and outlet search links', async () => {
    const response = await find()

    expect(response.story).toEqual({
      url: ARTICLE,
      headline: 'Rivera Pushes Sample Budget Through Senate',
      summary: 'An invented summary of the sample story.',
      byline: 'By Jordan Example',
      publishedAt: '2026-09-26T09:02:15.000Z',
      section: 'U.S.',
      source: 'nyt-api',
    })
    expect(response.coverage).toEqual([
      { outlet: 'AP News', title: 'Senate passes sample budget in late vote', url: ap.url, publishedAt: ap.publishedAt, match: 'same', accessNote: null },
      { outlet: 'NPR', title: 'What is in the Senate budget vote', url: npr.url, publishedAt: npr.publishedAt, match: 'same', accessNote: null },
      { outlet: 'The Hill', title: 'Senate budget vote draws swift reaction', url: hill.url, publishedAt: hill.publishedAt, match: 'same', accessNote: 'Some stories need a subscription' },
    ])
    expect(response.notices).toEqual([])
    expect(response.searchLinks[0]).toEqual({
      label: 'AP News',
      url: 'https://apnews.com/search?q=sample%20senate%20budget%20vote',
    })
    expect(response.searchLinks[response.searchLinks.length - 1].label).toBe('Google News')
  })

  it('searches free outlets around the publish date, adding only the central people the headline omits', async () => {
    await find()

    expect(searchNews).toHaveBeenCalledTimes(1)
    const [request] = searchNews.mock.calls[0]
    expect(request).toMatchObject({
      query: 'Rivera Pushes Sample Budget Through Senate Dana R Okafor',
      startDate: '2026-09-24',
      endDate: '2026-10-01',
    })
    expect(request.domains).toEqual(expect.arrayContaining(['apnews.com', 'npr.org', 'pbs.org']))
    expect(request.domains).not.toContain('cnn.com')
  })

  it('falls back to the words and date in the link when the NYT lookup fails', async () => {
    lookupArticle.mockResolvedValue(failed('rate-limited'))

    const response = await find()

    expect(response.story).toEqual({
      url: ARTICLE,
      headline: 'sample senate budget vote',
      summary: null,
      byline: null,
      publishedAt: '2026-09-26',
      section: null,
      source: 'link',
    })
    expect(response.notices).toEqual([expect.stringContaining('rate-limited')])
    expect(response.coverage?.map((item) => item.outlet)).toEqual(['AP News', 'NPR', 'The Hill'])
    expect(searchNews.mock.calls[0][0]).toMatchObject({
      query: 'sample senate budget vote',
      startDate: '2026-09-24',
      endDate: '2026-10-01',
    })
  })

  it('still returns the story and search links when the coverage search fails', async () => {
    searchNews.mockResolvedValue(failed('quota'))

    const response = await find()

    expect(response.story.source).toBe('nyt-api')
    expect(response.coverage).toBeNull()
    expect(response.notices).toEqual([expect.stringContaining('quota')])
    expect(response.searchLinks.length).toBeGreaterThan(1)
    expect(searchNews).toHaveBeenCalledTimes(1)
  })

  it('searches once more, wider and by the link words, when fewer than three matches turn up', async () => {
    searchNews.mockResolvedValueOnce(found([ap])).mockResolvedValueOnce(found([ap, npr]))

    const response = await find()

    expect(response.coverage?.map((item) => item.outlet)).toEqual(['AP News', 'NPR'])
    expect(searchNews).toHaveBeenCalledTimes(2)
    expect(searchNews.mock.calls[1][0]).toMatchObject({
      query: 'sample senate budget vote',
      startDate: '2026-09-19',
      endDate: '2026-10-26',
    })
  })

  it('never searches past today, and reports an empty list when nothing matches', async () => {
    searchNews.mockResolvedValue(found([]))

    const response = await find('2026-09-27')

    expect(response.coverage).toEqual([])
    expect(searchNews.mock.calls.map(([request]) => request.endDate)).toEqual(['2026-09-27', '2026-09-27'])
  })
})
