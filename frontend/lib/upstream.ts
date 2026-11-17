export type UpstreamFailure =
  | 'missing-key'
  | 'unauthorized'
  | 'rate-limited'
  | 'quota'
  | 'not-found'
  | 'unavailable'

export type Lookup<T> = { ok: true; value: T } | { ok: false; failure: UpstreamFailure }

export function found<T>(value: T): Lookup<T> {
  return { ok: true, value }
}

export function failed(failure: UpstreamFailure): Lookup<never> {
  return { ok: false, failure }
}

// Resolves to null when the service cannot be reached or does not answer in time.
export async function requestJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body: unknown = await response.json().catch(() => null)
    return { status: response.status, body }
  } catch {
    return null
  }
}
