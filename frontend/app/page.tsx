'use client'

import Image from 'next/image'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { CoverageResponse } from '@/lib/coverage'
import { parseNytLink } from '@/lib/nyt-url'

const NYT_API_SITE = 'https://developer.nytimes.com'
const NYT_CREDIT = 'Data provided by The New York Times'

function formatDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  // A date with no time of day (from the link, or reported by the search as midnight UTC) must not
  // shift with the reader's time zone.
  const isDateOnly = value.length === 10 || value.endsWith('T00:00:00.000Z')
  return date
    .toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: isDateOnly ? 'UTC' : undefined,
    })
    .replace(/ /g, '\u00a0')
}

function Results({ result, giftUrl }: { result: CoverageResponse; giftUrl: string | null }) {
  const { story, coverage, searchLinks, notices } = result
  const fromNyt = story.source === 'nyt-api'
  const details = [story.byline, formatDate(story.publishedAt), story.section]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {giftUrl && (
        <p className="message">
          This is a gift link, so it opens the full article for free.{' '}
          <a href={giftUrl} target="_blank" rel="noopener noreferrer">
            Read it on nytimes.com
          </a>
        </p>
      )}
      {notices.map((notice) => (
        <p className="message" key={notice}>
          {notice}
        </p>
      ))}

      <section className="story" aria-labelledby="story-title">
        <p className="eyebrow">{fromNyt ? 'The New York Times' : 'Words from the link'}</p>
        <h2 id="story-title">
          <a href={story.url} target="_blank" rel="noopener noreferrer">
            {story.headline}
          </a>
        </h2>
        {details && <p className="details">{details}</p>}
        {story.summary && <p className="summary">{story.summary}</p>}
        {fromNyt && (
          <a className="credit" href={NYT_API_SITE} target="_blank" rel="noopener noreferrer">
            <Image
              className="credit-light"
              src="/poweredby_nytimes_200a.png"
              alt={NYT_CREDIT}
              width={200}
              height={40}
              unoptimized
            />
            <Image
              className="credit-dark"
              src="/poweredby_nytimes_200c.png"
              alt={NYT_CREDIT}
              width={200}
              height={40}
              unoptimized
            />
          </a>
        )}
      </section>

      {coverage && (
        <section aria-labelledby="coverage-title">
          <h2 id="coverage-title" className="section-title">
            Free coverage
          </h2>
          {coverage.length > 0 ? (
            <ul className="coverage">
              {coverage.map((item) => {
                const date = formatDate(item.publishedAt)
                return (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </a>
                    <p className="details">
                      <span className={`tag ${item.match}`}>
                        {item.match === 'same' ? 'Same story' : 'Related'}
                      </span>
                      <span>
                        {item.outlet}
                        {date && ` · ${date}`}
                      </span>
                    </p>
                    {item.accessNote && <p className="access-note">{item.accessNote}</p>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="empty">No direct matches found. Try the outlet searches below.</p>
          )}
        </section>
      )}

      <section aria-labelledby="search-title">
        <h2 id="search-title" className="section-title">
          Search an outlet yourself
        </h2>
        <ul className="chips">
          {searchLinks.map((link) => (
            <li key={link.label}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export default function Home() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CoverageResponse | null>(null)
  const [giftUrl, setGiftUrl] = useState<string | null>(null)
  const [canPaste, setCanPaste] = useState(false)
  const latestRequest = useRef<AbortController | null>(null)
  const openedSharedLink = useRef(false)

  const lookUp = useCallback(async (text: string) => {
    latestRequest.current?.abort()
    setResult(null)
    setGiftUrl(null)

    const parsed = parseNytLink(text)
    if (!parsed.ok) {
      setLoading(false)
      setError(parsed.message)
      return
    }

    const { url } = parsed.link
    const controller = new AbortController()
    latestRequest.current = controller
    setInput(url)
    setError(null)
    setLoading(true)
    window.history.replaceState(null, '', `?url=${encodeURIComponent(url)}`)

    let failure: string | null = 'Could not reach the server. Check your connection and try again.'
    try {
      const response = await fetch(`/api/coverage?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      })
      const body = await response.json().catch(() => null)
      if (response.ok && body) {
        setResult(body)
        setGiftUrl(parsed.link.giftUrl)
        failure = null
      } else {
        failure = body?.error ?? 'Something went wrong. Please try again.'
      }
    } catch {
      // Network failure, or a newer lookup aborted this one.
    }

    if (latestRequest.current !== controller) return
    setLoading(false)
    setError(failure)
  }, [])

  useEffect(() => {
    setCanPaste(typeof navigator.clipboard?.readText === 'function')

    // Strict mode runs effects twice in development; a shared link should be looked up once.
    if (openedSharedLink.current) return
    openedSharedLink.current = true
    const shared = new URLSearchParams(window.location.search).get('url')
    if (shared) {
      setInput(shared)
      void lookUp(shared)
    }
  }, [lookUp])

  function submit(event: FormEvent) {
    event.preventDefault()
    void lookUp(input)
  }

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) return
      setInput(text)
      void lookUp(text)
    } catch {
      setError('Clipboard access was blocked. Paste the link into the box instead.')
    }
  }

  return (
    <main className="page">
      <header className="masthead">
        <h1>Free Coverage Finder</h1>
        <p>Paste a New York Times link to find the same story on news sites that are free to read.</p>
      </header>

      <form className="lookup" onSubmit={submit}>
        <label htmlFor="link">New York Times article link</label>
        <div className="lookup-row">
          <input
            id="link"
            type="text"
            inputMode="url"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://www.nytimes.com/2026/…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {canPaste && (
            <button type="button" className="secondary" onClick={paste} disabled={loading}>
              Paste
            </button>
          )}
        </div>
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? 'Searching…' : 'Find free coverage'}
        </button>
      </form>

      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="message" role="status">
          Looking up the story and searching free outlets…
        </p>
      )}
      {result && <Results result={result} giftUrl={giftUrl} />}

      <footer className="footnote">
        This page shows headlines and links only. It never copies article text and never opens
        nytimes.com on your behalf.
      </footer>
    </main>
  )
}
