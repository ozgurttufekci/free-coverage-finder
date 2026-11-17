import { toIso } from './dates'
import { failed, found, requestJson, type Lookup } from './upstream'

const ENDPOINT = 'https://api.tavily.com/search'
// Live searches were seen to take up to 5 seconds.
const TIMEOUT_MS = 12000
const MAX_QUERY_LENGTH = 400

export interface NewsSearchRequest {
  query: string
  domains: string[]
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
}

export interface NewsResult {
  title: string
  url: string
  publishedAt: string | null
  score: number
}

function toResults(body: unknown): NewsResult[] {
  const results = (body as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) return []
  return results.flatMap((result: unknown) => {
    if (typeof result !== 'object' || result === null) return []
    const { title, url, published_date, score } = result as Record<string, unknown>
    if (typeof title !== 'string' || typeof url !== 'string') return []
    return [
      {
        title,
        url,
        publishedAt: toIso(published_date),
        score: typeof score === 'number' ? score : 0,
      },
    ]
  })
}

export async function searchNews(request: NewsSearchRequest): Promise<Lookup<NewsResult[]>> {
  const key = process.env.TAVILY_API_KEY?.trim()
  if (!key) return failed('missing-key')

  const response = await requestJson(
    ENDPOINT,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: request.query.slice(0, MAX_QUERY_LENGTH),
        topic: 'news',
        search_depth: 'basic',
        max_results: 20,
        include_domains: request.domains,
        start_date: request.startDate,
        end_date: request.endDate,
      }),
    },
    TIMEOUT_MS,
  )
  if (!response) return failed('unavailable')
  if (response.status === 401 || response.status === 403) return failed('unauthorized')
  if (response.status === 429) return failed('rate-limited')
  // 432 and 433 are Tavily's plan-limit and pay-as-you-go-limit responses.
  if (response.status === 432 || response.status === 433) return failed('quota')
  if (response.status !== 200) return failed('unavailable')
  return found(toResults(response.body))
}
