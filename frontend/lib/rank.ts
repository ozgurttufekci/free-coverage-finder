import { daysBetween } from './dates'
import { outletFor, type Outlet, type OutletAccess } from './outlets'
import type { NewsResult } from './tavily'

export type Match = 'same' | 'related'

export interface StoryRef {
  headline: string
  slugWords: string[]
  /** The people the story is about (NYT's top-ranked person tags), usually "Last, First". */
  people: string[]
  /** Other people NYT tags on the story. Their names say little about whether a result is on topic. */
  mentionedPeople: string[]
  /** ISO timestamp or YYYY-MM-DD. */
  publishedAt: string | null
  /** False for opinion and other non-news pieces, which never have a "same story" elsewhere. */
  sameStoryEligible: boolean
}

export interface RankedItem {
  outlet: Outlet
  title: string
  url: string
  publishedAt: string | null
  match: Match
}

interface Candidate {
  outlet: Outlet
  order: number
  title: string
  url: string
  key: string
  isAmp: boolean
  words: string[]
  publishedAt: string | null
  providerScore: number
}

const MAX_PER_OUTLET = 2
const MAX_TOTAL = 8
const SAME_STORY_DAYS = 3

// The search pads thin result lists with unrelated pages that score near zero, while real matches for
// a headline score well above 0.25. In between, a result must also share wording with the story.
const MIN_SCORE = 0.25
const MIN_SCORE_WITH_SHARED_WORDING = 0.15
// On live stories, reports of the same event scored 0.65 and up; look-alikes that merely shared a
// surname or a few common words scored under 0.4.
const SAME_STORY_MIN_SCORE = 0.5

const ACCESS_ORDER: Record<OutletAccess, number> = { free: 0, 'mostly-free': 1, limited: 2 }

const INDEX_PAGE =
  /\/(?:tags?|topics?|hubs?|authors?|people|profile|search|videos?|transcripts?|newsletters?|live|live-updates|live-blog|liveblog)(?:\/|$)/i
const ARTICLE_SLUG = /[a-z0-9]+(?:-[a-z0-9]+){2,}/i

const STOPWORDS = new Set(
  (
    'the and for are but not you all any can had her was one our out has his how its may new now who why ' +
    'with from that this will have been were they them their what when where which while about after ' +
    'before over under into than then says say said amid more most some just also could would should ' +
    'news here there against does did being him she your off per via ' +
    'administration president government official'
  ).split(' '),
)

function unique<T>(items: T[]): T[] {
  return items.filter((item, index) => items.indexOf(item) === index)
}

// Lowercased significant words, accents removed and plurals trimmed so "Erdoğan's tariffs" meets "Erdogan tariff".
export function tokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

function surname(person: string): string | undefined {
  const words = tokens(person.split(',')[0])
  return words[words.length - 1]
}

// Page titles end with the outlet's name or domain, sometimes followed by a tagline:
// "Headline | AP News", "Headline - ABC News - Breaking News, Latest News and Videos".
function cleanTitle(title: string, outlet: Outlet): string {
  const names = outlet.titleNames
    .concat(outlet.domains)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const outletSuffix = new RegExp(`\\s+[|\\-–—:]\\s+(?:${names})(?:\\s*[|\\-–—:,].*)?\\s*$`, 'i')
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .replace(outletSuffix, '')
    .split(' | ')[0]
    .replace(/\s*\.{3}$/, '…')
    .trim()
}

function sameHeadline(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  const shared = a.filter((word) => b.includes(word)).length
  return shared / unique(a.concat(b)).length >= 0.8
}

export function rankCoverage(story: StoryRef, results: NewsResult[], outlets: Outlet[]): RankedItem[] {
  const nameWords = unique(story.people.concat(story.mentionedPeople).flatMap(tokens))
  const surnames = unique(story.people.flatMap((person) => surname(person) ?? []))
  const storyWords = unique(tokens(`${story.headline} ${story.slugWords.join(' ')}`)).filter(
    (word) => !nameWords.includes(word),
  )

  const candidates = results
    .flatMap((result): Candidate[] => {
      let url: URL
      try {
        url = new URL(result.url)
      } catch {
        return []
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return []
      const outlet = outletFor(url, outlets)
      if (!outlet || !ARTICLE_SLUG.test(url.pathname) || INDEX_PAGE.test(url.pathname)) return []
      const title = cleanTitle(result.title, outlet)
      if (!title) return []
      // An AMP page is the same article at /amp/… or on an amp. host.
      const path = url.pathname.replace(/^\/amp(?=\/)/i, '').replace(/\/$/, '')
      return [
        {
          outlet,
          order: outlets.indexOf(outlet),
          title,
          url: result.url,
          key: `${url.hostname.replace(/^(?:www|amp)\./i, '')}${path}`.toLowerCase(),
          isAmp: /^\/amp\//i.test(url.pathname) || /^amp\./i.test(url.hostname),
          words: unique(tokens(title)),
          publishedAt: result.publishedAt,
          providerScore: result.score,
        },
      ]
    })
    .sort(
      (a, b) =>
        a.order - b.order || Number(a.isAmp) - Number(b.isAmp) || b.providerScore - a.providerScore,
    )

  // Wire stories are republished under near-identical headlines; the higher-priority outlet's copy wins.
  const distinct: Candidate[] = []
  for (const candidate of candidates) {
    const isRepeat = distinct.some(
      (kept) => kept.key === candidate.key || sameHeadline(kept.words, candidate.words),
    )
    if (!isRepeat) distinct.push(candidate)
  }

  const labelled = distinct.flatMap((candidate) => {
    const nameHits = surnames.filter((name) => candidate.words.includes(name)).length
    const wordHits = storyWords.filter((word) => candidate.words.includes(word)).length
    const sharesWording = wordHits >= 2 || (nameHits >= 1 && wordHits >= 1)
    const isRelevant =
      candidate.providerScore >= MIN_SCORE ||
      (candidate.providerScore >= MIN_SCORE_WITH_SHARED_WORDING && sharesWording)
    if (!isRelevant) return []

    const isClose =
      story.publishedAt !== null &&
      candidate.publishedAt !== null &&
      daysBetween(story.publishedAt, candidate.publishedAt) <= SAME_STORY_DAYS
    // Outlets word the same event differently, so naming the person the story is about counts for a lot.
    const isStrong = (nameHits >= 1 && wordHits >= 1) || wordHits >= 3
    const isSameStory =
      story.sameStoryEligible && isStrong && isClose && candidate.providerScore >= SAME_STORY_MIN_SCORE
    const match: Match = isSameStory ? 'same' : 'related'
    return [{ ...candidate, match }]
  })

  labelled.sort(
    (a, b) =>
      Number(b.match === 'same') - Number(a.match === 'same') ||
      Number(Boolean(b.outlet.preferred)) - Number(Boolean(a.outlet.preferred)) ||
      ACCESS_ORDER[a.outlet.access] - ACCESS_ORDER[b.outlet.access] ||
      b.providerScore - a.providerScore ||
      a.order - b.order,
  )

  const perOutlet: Record<string, number> = {}
  const ranked: RankedItem[] = []
  for (const { outlet, title, url, publishedAt, match } of labelled) {
    const count = perOutlet[outlet.id] ?? 0
    if (count >= MAX_PER_OUTLET) continue
    perOutlet[outlet.id] = count + 1
    ranked.push({ outlet, title, url, publishedAt, match })
    if (ranked.length === MAX_TOTAL) break
  }
  return ranked
}
