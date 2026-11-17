import { addDays } from './dates'
import type { NytArticle } from './nyt-api'
import type { NytLink } from './nyt-url'
import { ACCESS_NOTES, activeOutlets, searchLinks, type Outlet, type SearchLink } from './outlets'
import { rankCoverage, type Match, type RankedItem } from './rank'
import type { NewsResult, NewsSearchRequest } from './tavily'
import type { Lookup, UpstreamFailure } from './upstream'

export interface Story {
  url: string
  /** The NYT headline, or the words from the link when NYT's API gave no record. */
  headline: string
  summary: string | null
  byline: string | null
  /** ISO timestamp from NYT's API, or YYYY-MM-DD from the link. */
  publishedAt: string | null
  section: string | null
  source: 'nyt-api' | 'link'
}

export interface CoverageItem {
  outlet: string
  title: string
  url: string
  publishedAt: string | null
  match: Match
  accessNote: string | null
}

export interface CoverageResponse {
  story: Story
  /** Null when the coverage search could not run; a notice says why. */
  coverage: CoverageItem[] | null
  searchLinks: SearchLink[]
  notices: string[]
}

export interface CoverageDeps {
  lookupArticle: (link: NytLink) => Promise<Lookup<NytArticle>>
  searchNews: (request: NewsSearchRequest) => Promise<Lookup<NewsResult[]>>
  outlets?: Outlet[]
  /** YYYY-MM-DD; defaults to the current UTC date. */
  today?: string
}

type DayWindow = [daysBefore: number, daysAfter: number]

const NARROW: DayWindow = [2, 5]
const WIDE: DayWindow = [7, 30]
const ENOUGH_MATCHES = 3
// NYT ranks a story's tags by how central they are. People further down are only mentioned in passing.
const CENTRAL_TAGS = 3

const FROM_LINK = 'so this search uses the words and date in the link.'
const STORY_NOTICES: Record<UpstreamFailure, string> = {
  'missing-key': `NYT story details are not set up yet (NYT_API_KEY is missing), ${FROM_LINK}`,
  unauthorized: `The NYT API rejected its key, ${FROM_LINK}`,
  'rate-limited': `The NYT API is rate-limited right now, ${FROM_LINK} Try again in a minute for the headline and summary.`,
  quota: `The NYT API has reached its daily limit, ${FROM_LINK}`,
  'not-found': `The NYT API has no record of this link, ${FROM_LINK}`,
  unavailable: `The NYT API did not respond, ${FROM_LINK}`,
}

const USE_SEARCHES = 'Use the outlet searches below.'
const SEARCH_NOTICES: Record<UpstreamFailure, string> = {
  'missing-key': `Coverage search is not set up yet (TAVILY_API_KEY is missing). ${USE_SEARCHES}`,
  unauthorized: `The coverage search rejected its key. ${USE_SEARCHES}`,
  'rate-limited': `The coverage search is rate-limited right now. ${USE_SEARCHES}`,
  quota: `The coverage search has used up its quota for this month. ${USE_SEARCHES}`,
  'not-found': `The coverage search did not respond. ${USE_SEARCHES}`,
  unavailable: `The coverage search did not respond. ${USE_SEARCHES}`,
}

function isNews(article: NytArticle): boolean {
  const isOpinion = /opinion/i.test(article.section ?? '')
  return !isOpinion && (!article.materialType || /^news$/i.test(article.materialType))
}

// Adds the central people the headline leaves out, e.g. "Trump, Donald J" becomes "Donald J Trump".
function withPeople(headline: string, people: string[]): string {
  const missing = people.flatMap((person) => {
    const [last, first] = person.split(',').map((part) => part.trim())
    if (!last || headline.toLowerCase().includes(last.toLowerCase())) return []
    return [first ? `${first} ${last}` : last]
  })
  return [headline, ...missing].join(' ')
}

export async function findCoverage(link: NytLink, deps: CoverageDeps): Promise<CoverageResponse> {
  const outlets = deps.outlets ?? activeOutlets()
  const today = deps.today ?? new Date().toISOString().slice(0, 10)
  const terms = link.slugWords.join(' ')
  const notices: string[] = []

  const lookup = await deps.lookupArticle(link)
  const article = lookup.ok ? lookup.value : null
  if (!lookup.ok) notices.push(STORY_NOTICES[lookup.failure])

  const story: Story = article
    ? {
        url: link.url,
        headline: article.headline,
        summary: article.summary,
        byline: article.byline,
        publishedAt: article.publishedAt,
        section: article.section,
        source: 'nyt-api',
      }
    : {
        url: link.url,
        headline: terms,
        summary: null,
        byline: null,
        publishedAt: link.pathDate,
        section: null,
        source: 'link',
      }

  // NYT writes some names with a qualifier, e.g. "Farage, Nigel (1964- )".
  const personTags = (tags: NytArticle['tags']) =>
    tags.filter((tag) => tag.kind === 'person').map((tag) => tag.value.replace(/\s*\([^)]*\)/g, ''))
  const people = article ? personTags(article.tags.slice(0, CENTRAL_TAGS)) : []
  const mentionedPeople = article ? personTags(article.tags.slice(CENTRAL_TAGS)) : []
  const rank = (results: NewsResult[]) =>
    rankCoverage(
      {
        headline: story.headline,
        slugWords: link.slugWords,
        people,
        mentionedPeople,
        publishedAt: story.publishedAt,
        sameStoryEligible: article ? isNews(article) : !link.isOpinion,
      },
      results,
      outlets,
    )

  const day = (story.publishedAt ?? link.pathDate).slice(0, 10)
  const domains = outlets.flatMap((outlet) => outlet.domains)
  const request = (query: string, [daysBefore, daysAfter]: DayWindow): NewsSearchRequest => {
    const startDate = addDays(day, -daysBefore)
    const latest = addDays(day, daysAfter)
    const endDate = latest < today ? latest : today
    return { query, domains, startDate, endDate: endDate < startDate ? startDate : endDate }
  }

  let ranked: RankedItem[] | null = null
  const first = request(article ? withPeople(article.headline, people) : terms, NARROW)
  const firstSearch = await deps.searchNews(first)
  if (!firstSearch.ok) {
    notices.push(SEARCH_NOTICES[firstSearch.failure])
  } else {
    ranked = rank(firstSearch.value)
    const wider = request(terms, WIDE)
    if (ranked.length < ENOUGH_MATCHES && JSON.stringify(wider) !== JSON.stringify(first)) {
      const secondSearch = await deps.searchNews(wider)
      if (secondSearch.ok) ranked = rank(firstSearch.value.concat(secondSearch.value))
    }
  }

  return {
    story,
    coverage:
      ranked &&
      ranked.map(({ outlet, title, url, publishedAt, match }) => ({
        outlet: outlet.name,
        title,
        url,
        publishedAt,
        match,
        accessNote: ACCESS_NOTES[outlet.access],
      })),
    searchLinks: searchLinks(terms, outlets),
    notices,
  }
}
