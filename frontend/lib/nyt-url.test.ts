import { describe, expect, it } from 'vitest'
import { parseNytLink } from './nyt-url'

const ARTICLE = 'https://www.nytimes.com/2026/09/26/us/politics/sample-senate-budget-vote.html'

function link(input: string) {
  const result = parseNytLink(input)
  if (!result.ok) throw new Error(result.message)
  return result.link
}

describe('parseNytLink', () => {
  it('strips tracking parameters and normalizes the host and scheme', () => {
    const shared =
      'http://mobile.nytimes.com/2026/09/26/us/politics/sample-senate-budget-vote.html' +
      '?smid=nytcore-ios-share&referringSource=articleShare#top'

    expect(link(shared)).toEqual({
      url: ARTICLE,
      slugWords: ['sample', 'senate', 'budget', 'vote'],
      pathDate: '2026-09-26',
      isOpinion: false,
      giftUrl: null,
    })
  })

  it('finds the link inside pasted share text', () => {
    expect(link(`An Invented Headline ${ARTICLE}?smid=url-share.`).url).toBe(ARTICLE)
    expect(link('nytimes.com/2026/09/26/us/politics/sample-senate-budget-vote.html').url).toBe(ARTICLE)
  })

  it('keeps only the gift code from a gift link', () => {
    const gift = link(`${ARTICLE}?unlocked_article_code=1.AbC-dEf&smid=url-share`)

    expect(gift.url).toBe(ARTICLE)
    expect(gift.giftUrl).toBe(`${ARTICLE}?unlocked_article_code=1.AbC-dEf`)
  })

  it('accepts live, opinion and Athletic article paths', () => {
    expect(link('https://www.nytimes.com/live/2026/09/26/us/sample-election-updates').slugWords).toEqual([
      'sample',
      'election',
      'updates',
    ])
    expect(link('https://www.nytimes.com/2026/09/26/opinion/sample-guest-essay.html').isOpinion).toBe(true)
    expect(
      link('https://www.nytimes.com/athletic/5512345/2026/09/26/sample-playoff-preview/'),
    ).toMatchObject({ pathDate: '2026-09-26', slugWords: ['sample', 'playoff', 'preview'] })
  })

  it.each([
    'https://nytimes.com.example.org/2026/09/26/us/sample-senate-budget-vote.html',
    'https://nytimes.com@example.org/2026/09/26/us/sample-senate-budget-vote.html',
    'https://evilnytimes.com/2026/09/26/us/sample-senate-budget-vote.html',
    'https://user:secret@www.nytimes.com/2026/09/26/us/sample-senate-budget-vote.html',
  ])('rejects %s as not from nytimes.com', (input) => {
    expect(parseNytLink(input)).toEqual({
      ok: false,
      message: expect.stringContaining('not from nytimes.com'),
    })
  })

  it.each([
    'https://www.nytimes.com/',
    'https://www.nytimes.com/section/world',
    'https://www.nytimes.com/games/wordle/index.html',
    'https://cooking.nytimes.com/recipes/1234-sample-soup',
    'https://www.nytimes.com/2026/13/45/us/sample-senate-budget-vote.html',
    'https://www.nytimes.com/2026/09/26/',
  ])('rejects %s as not an article', (input) => {
    expect(parseNytLink(input)).toEqual({
      ok: false,
      message: expect.stringContaining('not an article'),
    })
  })

  it('explains that short links are not supported', () => {
    expect(parseNytLink('https://nyti.ms/4abcDEF')).toEqual({
      ok: false,
      message: expect.stringContaining('nyti.ms'),
    })
  })

  it('asks for a link when given none', () => {
    expect(parseNytLink('   ')).toEqual({ ok: false, message: 'Paste a New York Times article link.' })
    expect(parseNytLink('sample senate budget vote')).toEqual({
      ok: false,
      message: expect.stringContaining('does not look like a link'),
    })
  })
})
