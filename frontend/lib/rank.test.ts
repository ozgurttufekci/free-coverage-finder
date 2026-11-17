import { describe, expect, it } from 'vitest'
import { activeOutlets } from './outlets'
import { rankCoverage, tokens, type StoryRef } from './rank'
import type { NewsResult } from './tavily'

const outlets = activeOutlets()

const story: StoryRef = {
  headline: 'Senate Passes Sample Budget After Late Vote',
  slugWords: ['sample', 'senate', 'budget', 'vote'],
  people: ['Rivera, Morgan'],
  mentionedPeople: [],
  publishedAt: '2026-09-26T09:00:00.000Z',
  sameStoryEligible: true,
}

const SAME_DAY = '2026-09-26T15:00:00.000Z'
const NEXT_WEEK = '2026-10-02T12:00:00.000Z'

function result(url: string, title: string, publishedAt: string | null = SAME_DAY, score = 0.7): NewsResult {
  return { url, title, publishedAt, score }
}

function summarize(results: NewsResult[], ref: StoryRef = story) {
  return rankCoverage(ref, results, outlets).map(({ outlet, match }) => [outlet.id, match])
}

describe('rankCoverage', () => {
  it('keeps articles from listed outlets and drops other pages', () => {
    const ranked = rankCoverage(
      story,
      [
        result('https://apnews.com/article/senate-sample-budget-vote-abc123', 'Senate passes sample budget in late vote | AP News'),
        result('https://example.com/news/senate-sample-budget-vote', 'Senate passes sample budget in late vote'),
        result('https://apnews.com/hub/senate-sample-budget', 'Senate sample budget vote | AP News'),
        result('https://www.nbcnews.com/video/senate-passes-sample-budget-123456', 'Senate passes sample budget'),
        result('https://www.theguardian.com/us-news/live/2026/sep/26/senate-sample-budget-vote-live', 'Senate budget vote live'),
        result('https://www.pbs.org/video/senate-sample-budget-vote/', 'Senate sample budget vote'),
        result('https://www.politico.com/newsletters/playbook/2026/09/26/senate-sample-budget-vote-00112233', 'Senate sample budget vote - Politico'),
        result('https://www.nbcnews.com/meet-the-press/transcripts/senate-sample-budget-vote-rcna1', 'Senate sample budget vote - NBC News'),
        result('https://www.cbsnews.com/politics/', 'Senate budget vote - CBS News'),
        result('not a url', 'Senate passes sample budget'),
      ],
      outlets,
    )

    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({
      url: 'https://apnews.com/article/senate-sample-budget-vote-abc123',
      title: 'Senate passes sample budget in late vote',
      match: 'same',
    })
    expect(ranked[0].outlet.id).toBe('ap')
  })

  it('separates the same story from related coverage', () => {
    expect(
      summarize([
        result('https://www.cbsnews.com/news/morgan-rivera-long-career/', 'Morgan Rivera reflects on a long career'),
        result('https://www.npr.org/2026/10/02/nx-s1-1/what-the-budget-vote-means', 'What the Senate budget vote means', NEXT_WEEK),
        result('https://www.theguardian.com/us-news/2026/sep/26/rivera-steers-spending-plan-through-senate', 'Rivera steers spending plan through Senate'),
        result('https://apnews.com/article/senate-sample-budget-vote-abc123', 'Senate passes sample budget in late vote'),
      ]),
    ).toEqual([
      ['ap', 'same'],
      ['guardian', 'same'],
      ['npr', 'related'],
      ['cbs', 'related'],
    ])
  })

  it('drops what the search scores as unrelated, and needs shared wording for middling scores', () => {
    expect(
      summarize([
        result('https://www.politico.com/news/2026/09/26/storm-closes-coast-roads-001', 'Storm closes roads across the coast', SAME_DAY, 0.02),
        result('https://www.theguardian.com/us-news/2026/sep/26/senate-budget-vote-explained', 'Senate budget vote explained', SAME_DAY, 0.02),
        result('https://abcnews.com/Business/markets-steady-traders-await-data/story?id=1', 'Markets steady as traders await data', SAME_DAY, 0.2),
        result('https://www.cbsnews.com/news/budget-vote-leaves-senate-divided/', 'Budget vote leaves Senate leaders divided', SAME_DAY, 0.2),
      ]),
    ).toEqual([['cbs', 'related']])
  })

  it('needs a high search score, not just shared wording, to call something the same story', () => {
    const lookalike = (score: number) => [
      result('https://thehill.com/homenews/senate/5512345-rivera-seeks-delay-budget-vote/', 'Sen. Alex Rivera seeks to delay Senate budget vote', SAME_DAY, score),
    ]

    expect(summarize(lookalike(0.38))).toEqual([['thehill', 'related']])
    expect(summarize(lookalike(0.65))).toEqual([['thehill', 'same']])
  })

  it('ignores the name of someone the story only mentions in passing', () => {
    const about = {
      ...story,
      headline: 'Okafor Allies Split Over Sample Budget',
      slugWords: ['okafor', 'allies', 'budget'],
    }
    const results = [
      result('https://www.cbsnews.com/news/okafor-visits-flood-zone-budget-talks/', 'Okafor visits flood zone as budget talks stall', SAME_DAY, 0.2),
    ]

    expect(summarize(results, { ...about, people: [], mentionedPeople: ['Okafor, Dana'] })).toEqual([])
    expect(summarize(results, { ...about, people: ['Okafor, Dana'], mentionedPeople: [] })).toEqual([
      ['cbs', 'related'],
    ])
  })

  it('removes outlet names and taglines from real page titles', () => {
    const ranked = rankCoverage(
      story,
      [
        result('https://www.politico.com/news/2026/09/26/senate-budget-vote-reaction-001', 'Senate budget vote draws swift reaction - politico.com'),
        result('https://abcnews.com/Politics/senate-sample-budget-vote/story?id=1', 'Senate passes sample budget in late vote - ABC News - Breaking News, Latest News and Videos'),
        result('https://www.theguardian.com/us-news/2026/sep/26/senate-sample-budget-vote', 'Senate budget vote: what happens next for ...'),
        result('https://www.aljazeera.com/news/2026/9/26/senate-budget-vote-world-reaction', 'World reacts to Senate budget vote | Politics News | Al Jazeera'),
      ],
      outlets,
    )

    expect(ranked.map((item) => item.title)).toEqual([
      'Senate budget vote: what happens next for…',
      'World reacts to Senate budget vote',
      'Senate passes sample budget in late vote',
      'Senate budget vote draws swift reaction',
    ])
  })

  it('never calls coverage of an opinion piece the same story', () => {
    const results = [
      result('https://apnews.com/article/senate-sample-budget-vote-abc123', 'Senate passes sample budget in late vote'),
    ]

    expect(summarize(results, { ...story, sameStoryEligible: false })).toEqual([['ap', 'related']])
  })

  it('counts a republished wire story once, keeping the higher-priority outlet', () => {
    expect(
      summarize([
        result('https://www.pbs.org/newshour/politics/senate-passes-sample-budget-in-late-vote', 'Senate passes sample budget in late vote | PBS News'),
        result('https://abcnews.com/Politics/wireStory/senate-passes-sample-budget-late-vote-123', 'Senate passes sample budget in late vote - ABC News'),
        result('https://apnews.com/article/senate-sample-budget-vote-abc123?utm_source=feed', 'Senate passes sample budget in late vote'),
        result('https://apnews.com/article/senate-sample-budget-vote-abc123', 'Senate passes sample budget in late vote | AP News'),
      ]),
    ).toEqual([['ap', 'same']])
  })

  it('links to the regular page when the search also returns its AMP copy', () => {
    const ranked = rankCoverage(
      story,
      [
        result('https://abcnews.com/amp/Politics/senate-sample-budget-vote/story?id=1', 'Senate passes sample budget in late vote - abcnews.com', SAME_DAY, 0.9),
        result('https://abcnews.com/Politics/senate-sample-budget-vote/story?id=1', 'Senate passes sample budget in late vote - ABC News', SAME_DAY, 0.5),
      ],
      outlets,
    )

    expect(ranked.map((item) => item.url)).toEqual([
      'https://abcnews.com/Politics/senate-sample-budget-vote/story?id=1',
    ])
  })

  it('lists same-story matches first and preferred outlets first, two per outlet and eight in total', () => {
    let pages = 0
    const page = (host: string, publishedAt = SAME_DAY) => {
      const angle = `angle${(pages += 1)}`
      return result(
        `https://${host}/news/senate-budget-vote-${angle}`,
        `Senate budget vote: ${angle} report${pages} detail${pages} notes${pages}`,
        publishedAt,
      )
    }

    expect(
      summarize([
        page('www.nbcnews.com', NEXT_WEEK),
        page('www.politico.com', NEXT_WEEK),
        page('abcnews.com', NEXT_WEEK),
        page('www.npr.org', NEXT_WEEK),
        page('thehill.com'),
        page('www.cbsnews.com'),
        page('www.theguardian.com'),
        page('www.theguardian.com'),
        page('www.theguardian.com'),
        page('apnews.com'),
        page('apnews.com'),
        page('apnews.com'),
      ]),
    ).toEqual([
      ['ap', 'same'],
      ['ap', 'same'],
      ['guardian', 'same'],
      ['guardian', 'same'],
      ['cbs', 'same'],
      ['thehill', 'same'],
      ['npr', 'related'],
      ['abc', 'related'],
    ])
  })
})

describe('tokens', () => {
  it('matches words across accents, possessives and plurals', () => {
    expect(tokens('Erdoğan’s Tariffs')).toEqual(tokens('Erdogan tariff'))
  })
})
