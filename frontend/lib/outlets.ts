export type OutletAccess = 'free' | 'mostly-free' | 'limited'

export interface Outlet {
  id: string
  name: string
  /** Names the outlet appends to page titles, longest first. Removed before a headline is shown. */
  titleNames: string[]
  domains: string[]
  /** Only pages under this path count as the outlet's news coverage. */
  pathPrefix?: string
  /** Listed ahead of other outlets with the same match strength. */
  preferred?: boolean
  access: OutletAccess
  searchUrl: (terms: string) => string
}

export interface SearchLink {
  label: string
  url: string
}

// Set to true to include outlets that meter free reading. Their results carry a note.
export const INCLUDE_LIMITED_OUTLETS = false

export const ACCESS_NOTES: Record<OutletAccess, string | null> = {
  free: null,
  'mostly-free': 'Some stories need a subscription',
  limited: 'Limited free reading',
}

const encode = encodeURIComponent

// For outlets with no site search of their own, or whose search could not be confirmed.
function siteSearch(domain: string) {
  return (terms: string) => `https://www.google.com/search?q=${encode(`${terms} site:${domain}`)}`
}

// Order is priority: when the same story appears twice, the earlier outlet's copy is kept.
// Access and search links were last checked in November 2026.
export const OUTLETS: Outlet[] = [
  {
    id: 'ap',
    name: 'AP News',
    titleNames: ['The Associated Press', 'Associated Press', 'AP News'],
    domains: ['apnews.com'],
    preferred: true,
    access: 'free',
    searchUrl: (terms) => `https://apnews.com/search?q=${encode(terms)}`,
  },
  {
    id: 'npr',
    name: 'NPR',
    titleNames: ['NPR'],
    domains: ['npr.org'],
    preferred: true,
    access: 'free',
    searchUrl: siteSearch('npr.org'),
  },
  {
    id: 'pbs',
    name: 'PBS News',
    titleNames: ['PBS News Hour', 'PBS NewsHour', 'PBS News', 'PBS'],
    domains: ['pbs.org'],
    pathPrefix: '/newshour',
    preferred: true,
    access: 'free',
    searchUrl: (terms) => `https://www.pbs.org/newshour/search-results?q=${encode(terms)}`,
  },
  {
    id: 'guardian',
    name: 'The Guardian',
    titleNames: ['The Guardian'],
    domains: ['theguardian.com'],
    access: 'free',
    searchUrl: siteSearch('theguardian.com'),
  },
  {
    id: 'aljazeera',
    name: 'Al Jazeera',
    titleNames: ['Al Jazeera English', 'Al Jazeera'],
    domains: ['aljazeera.com'],
    access: 'free',
    searchUrl: (terms) => `https://www.aljazeera.com/search/${encode(terms)}`,
  },
  {
    id: 'cbs',
    name: 'CBS News',
    titleNames: ['CBS News'],
    domains: ['cbsnews.com'],
    access: 'free',
    searchUrl: (terms) => `https://www.cbsnews.com/search/?q=${encode(terms)}`,
  },
  {
    id: 'abc',
    name: 'ABC News',
    titleNames: ['ABC News'],
    domains: ['abcnews.com', 'abcnews.go.com'],
    access: 'free',
    searchUrl: (terms) => `https://abcnews.com/search?searchtext=${encode(terms)}`,
  },
  {
    id: 'politico',
    name: 'Politico',
    titleNames: ['Politico'],
    domains: ['politico.com'],
    access: 'free',
    searchUrl: siteSearch('politico.com'),
  },
  {
    id: 'nbc',
    name: 'NBC News',
    titleNames: ['NBC News'],
    domains: ['nbcnews.com'],
    access: 'mostly-free',
    searchUrl: (terms) => `https://www.nbcnews.com/search/?q=${encode(terms)}`,
  },
  {
    id: 'thehill',
    name: 'The Hill',
    titleNames: ['The Hill'],
    domains: ['thehill.com'],
    access: 'mostly-free',
    searchUrl: siteSearch('thehill.com'),
  },
  {
    id: 'reuters',
    name: 'Reuters',
    titleNames: ['Reuters'],
    domains: ['reuters.com'],
    access: 'limited',
    searchUrl: siteSearch('reuters.com'),
  },
  {
    id: 'cnn',
    name: 'CNN',
    titleNames: ['CNN Politics', 'CNN Business', 'CNN'],
    domains: ['cnn.com'],
    access: 'limited',
    searchUrl: siteSearch('cnn.com'),
  },
  {
    id: 'bbc',
    name: 'BBC',
    titleNames: ['BBC News', 'BBC'],
    domains: ['bbc.com', 'bbc.co.uk'],
    access: 'limited',
    searchUrl: siteSearch('bbc.com'),
  },
]

export function activeOutlets(): Outlet[] {
  return OUTLETS.filter((outlet) => INCLUDE_LIMITED_OUTLETS || outlet.access !== 'limited')
}

export function outletFor(url: URL, outlets: Outlet[]): Outlet | undefined {
  const host = url.hostname.toLowerCase()
  return outlets.find(({ domains, pathPrefix }) => {
    const onDomain = domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
    const underPath =
      !pathPrefix || url.pathname === pathPrefix || url.pathname.startsWith(`${pathPrefix}/`)
    return onDomain && underPath
  })
}

export function searchLinks(terms: string, outlets: Outlet[]): SearchLink[] {
  return [
    ...outlets.map((outlet) => ({ label: outlet.name, url: outlet.searchUrl(terms) })),
    { label: 'Google News', url: `https://news.google.com/search?q=${encode(terms)}` },
  ]
}
