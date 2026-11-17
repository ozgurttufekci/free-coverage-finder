import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { findCoverage } from '@/lib/coverage'
import { lookupNytArticle } from '@/lib/nyt-api'
import { parseNytLink } from '@/lib/nyt-url'
import { searchNews, type NewsResult, type NewsSearchRequest } from '@/lib/tavily'
import type { Lookup } from '@/lib/upstream'

// Covers the worst case of two NYT lookups and two coverage searches all running to their timeouts.
export const maxDuration = 45

const SEARCH_CACHE_SECONDS = 60 * 60

// unstable_cache stores whatever its function returns. Failures and empty results are thrown instead,
// so they are retried on the next lookup rather than served for an hour.
class Uncached extends Error {
  constructor(readonly outcome: Lookup<NewsResult[]>) {
    super('Search outcome not cached')
  }
}

const cachedSearch = unstable_cache(
  async (request: NewsSearchRequest): Promise<NewsResult[]> => {
    const outcome = await searchNews(request)
    if (!outcome.ok || outcome.value.length === 0) throw new Uncached(outcome)
    return outcome.value
  },
  ['coverage-search'],
  { revalidate: SEARCH_CACHE_SECONDS },
)

async function searchNewsCached(request: NewsSearchRequest): Promise<Lookup<NewsResult[]>> {
  try {
    return { ok: true, value: await cachedSearch(request) }
  } catch (error) {
    return error instanceof Uncached ? error.outcome : { ok: false, failure: 'unavailable' }
  }
}

export async function GET(request: Request) {
  const parsed = parseNytLink(new URL(request.url).searchParams.get('url') ?? '')
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 })

  const coverage = await findCoverage(parsed.link, {
    lookupArticle: lookupNytArticle,
    searchNews: searchNewsCached,
  })
  return NextResponse.json(coverage)
}
