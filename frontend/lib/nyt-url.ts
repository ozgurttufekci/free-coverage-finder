export interface NytLink {
  /** https://www.nytimes.com + path, with tracking parameters removed. */
  url: string
  slugWords: string[]
  /** YYYY-MM-DD, as it appears in the link. */
  pathDate: string
  isOpinion: boolean
  /** The link with only its gift code kept, when the pasted link was a gift link. */
  giftUrl: string | null
}

export type NytLinkResult = { ok: true; link: NytLink } | { ok: false; message: string }

const MAIN_HOSTS = ['nytimes.com', 'www.nytimes.com', 'mobile.nytimes.com', 'm.nytimes.com']

const ASK = 'Paste a New York Times article link.'
const NOT_A_LINK = `That does not look like a link. ${ASK}`
const NOT_AN_ARTICLE =
  'That is an NYT page, but not an article. Article links include a date, like nytimes.com/2026/09/26/…'

function reject(message: string): NytLinkResult {
  return { ok: false, message }
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// Share sheets often paste "Headline https://…", so the link may sit inside other text.
export function extractUrl(text: string): string | null {
  const trimmed = text.trim()
  const embedded = trimmed.match(/https?:\/\/[^\s<>"']+/i)
  if (embedded) return embedded[0].replace(/[.,;:!?)\]]+$/, '')
  if (/^(?:[a-z0-9-]+\.)*(?:nytimes\.com|nyti\.ms)\/\S*$/i.test(trimmed)) return `https://${trimmed}`
  return null
}

export function parseNytLink(input: string): NytLinkResult {
  const candidate = extractUrl(input)
  if (!candidate) return reject(input.trim() ? NOT_A_LINK : ASK)

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return reject(NOT_A_LINK)
  }

  const host = parsed.hostname.toLowerCase()
  if (host === 'nyti.ms') {
    return reject(
      'Short nyti.ms links are not supported. Open the article and copy its full nytimes.com link.',
    )
  }
  const isNyt = host === 'nytimes.com' || host.endsWith('.nytimes.com')
  if (!isNyt || parsed.username || parsed.password) {
    return reject(`That link is not from nytimes.com. ${ASK}`)
  }

  const dated = parsed.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/(.+)$/)
  if (!dated) return reject(NOT_AN_ARTICLE)

  const [, year, month, day, rest] = dated
  const segments = rest.split('/').filter(Boolean)
  const slug = decode(segments[segments.length - 1] ?? '')
    .replace(/\.html?$/i, '')
    .toLowerCase()
  const isCalendarDate = Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31
  if (!isCalendarDate || !/[a-z]/.test(slug)) return reject(NOT_AN_ARTICLE)

  const url = `https://${MAIN_HOSTS.includes(host) ? 'www.nytimes.com' : host}${parsed.pathname}`
  const giftCode = parsed.searchParams.get('unlocked_article_code')

  return {
    ok: true,
    link: {
      url,
      slugWords: slug.split(/[^a-z0-9]+/).filter(Boolean),
      pathDate: `${year}-${month}-${day}`,
      isOpinion: /\/opinion\//.test(parsed.pathname),
      giftUrl: giftCode ? `${url}?unlocked_article_code=${encodeURIComponent(giftCode)}` : null,
    },
  }
}
