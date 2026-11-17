import { addDays, toIso } from './dates'
import { parseNytLink, type NytLink } from './nyt-url'
import { failed, found, requestJson, type Lookup } from './upstream'

const ENDPOINT = 'https://api.nytimes.com/svc/search/v2/articlesearch.json'
const TIMEOUT_MS = 5000

export type TagKind = 'person' | 'organization' | 'location' | 'subject' | 'other'

export interface NytTag {
  kind: TagKind
  value: string
}

export interface NytArticle {
  url: string
  headline: string
  summary: string | null
  byline: string | null
  publishedAt: string | null
  section: string | null
  materialType: string | null
  /** Most central first, by NYT's own ranking. */
  tags: NytTag[]
}

interface ArticleDoc {
  web_url?: unknown
  abstract?: unknown
  snippet?: unknown
  headline?: { main?: unknown; print_headline?: unknown } | null
  byline?: { original?: unknown } | null
  pub_date?: unknown
  section_name?: unknown
  type_of_material?: unknown
  keywords?: unknown
}

// Accepts the long-standing plural tag names as well as the singular ones the filter fields use.
const TAG_KINDS: Record<string, TagKind> = {
  person: 'person',
  persons: 'person',
  organization: 'organization',
  organizations: 'organization',
  location: 'location',
  glocations: 'location',
  subject: 'subject',
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toTags(keywords: unknown): NytTag[] {
  if (!Array.isArray(keywords)) return []
  const rank = (keyword: Record<string, unknown>) =>
    typeof keyword.rank === 'number' ? keyword.rank : Number.MAX_SAFE_INTEGER
  return keywords
    .filter(isRecord)
    .sort((a, b) => rank(a) - rank(b))
    .flatMap((keyword) => {
      const value = text(keyword.value)
      const kind = TAG_KINDS[String(keyword.name).toLowerCase()] ?? 'other'
      return value ? [{ kind, value }] : []
    })
}

function toArticle(doc: ArticleDoc, url: string): NytArticle | null {
  const headline = text(doc.headline?.main) ?? text(doc.headline?.print_headline)
  if (!headline) return null
  return {
    url,
    headline,
    summary: text(doc.abstract) ?? text(doc.snippet),
    byline: text(doc.byline?.original),
    publishedAt: toIso(doc.pub_date),
    section: text(doc.section_name),
    materialType: text(doc.type_of_material),
    tags: toTags(doc.keywords),
  }
}

// Results are only trusted when their own URL is the requested article.
function pick(docs: ArticleDoc[], link: NytLink): NytArticle | null {
  const wanted = link.url.replace(/\/$/, '')
  for (const doc of docs) {
    const parsed = parseNytLink(text(doc.web_url) ?? '')
    if (parsed.ok && parsed.link.url.replace(/\/$/, '') === wanted) {
      const article = toArticle(doc, link.url)
      if (article) return article
    }
  }
  return null
}

async function search(params: Record<string, string>, key: string): Promise<Lookup<ArticleDoc[]>> {
  const query = new URLSearchParams({ ...params, 'api-key': key })
  const response = await requestJson(`${ENDPOINT}?${query.toString()}`, {}, TIMEOUT_MS)
  if (!response) return failed('unavailable')
  // A 400 means this form of query was not accepted; the caller can try another.
  if (response.status === 400) return found([])
  if (response.status === 401 || response.status === 403) return failed('unauthorized')
  if (response.status === 429) return failed('rate-limited')
  if (response.status !== 200) return failed('unavailable')
  const docs = (response.body as { response?: { docs?: unknown } } | null)?.response?.docs
  return found(Array.isArray(docs) ? docs.filter(isRecord) : [])
}

export async function lookupNytArticle(link: NytLink): Promise<Lookup<NytArticle>> {
  const key = process.env.NYT_API_KEY?.trim()
  if (!key) return failed('missing-key')

  const byUrl = await search({ fq: `url:"${link.url.replace(/["\\]/g, '\\$&')}"` }, key)
  if (!byUrl.ok) return byUrl
  const direct = pick(byUrl.value, link)
  if (direct) return found(direct)

  const compact = (day: string) => day.replace(/-/g, '')
  const byWords = await search(
    {
      q: link.slugWords.join(' '),
      begin_date: compact(addDays(link.pathDate, -1)),
      end_date: compact(addDays(link.pathDate, 1)),
    },
    key,
  )
  if (!byWords.ok) return byWords
  const match = pick(byWords.value, link)
  return match ? found(match) : failed('not-found')
}
