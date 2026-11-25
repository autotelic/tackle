/**
 * Why the provider failed, recorded instead of guessed.
 *
 * pi collapses every transport failure into the string "Connection error.", and
 * only the message reaches a session, so the loop cannot tell a dead pooled
 * socket (ECONNRESET) from a lost route (ENOTFOUND) or a broken tunnel
 * (UND_ERR_CONNECT_TIMEOUT). Those are four different bugs with four different
 * fixes, and choosing one blind is how time gets wasted.
 *
 * The SDK issues model calls through the global `fetch`, so wrapping it here
 * captures the real cause chain — code, errno, syscall, hostname — without
 * touching the dependency. The last failure is kept in memory for the loop's
 * next notice, and every failure is written to a jsonl sink for the morning.
 *
 * Nothing here changes behaviour: the wrapper calls the original fetch and
 * rethrows whatever it threw.
 */

export type FetchFailure = {
  at: string
  url: string
  /** The error the request threw (usually a TypeError: fetch failed). */
  name: string
  message: string
  /** Node's own code for the network cause: ECONNRESET, ENOTFOUND, … */
  code?: string
  errno?: string
  syscall?: string
  hostname?: string
  /** undici's own error code when the dispatcher reports one. */
  causeCode?: string
  causeMessage?: string
  /** HTTP status when the request completed but the provider refused it. */
  status?: number
}

type CauseLike = {
  name?: unknown
  message?: unknown
  code?: unknown
  errno?: unknown
  syscall?: unknown
  hostname?: unknown
  cause?: unknown
}

const asCause = (value: unknown): CauseLike | null =>
  typeof value === 'object' && value !== null ? (value as CauseLike) : null

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/** Flatten an error and its cause chain into the few fields that identify it. */
export function describeFailure(error: unknown, url: string, at = new Date()): FetchFailure {
  const top = asCause(error)
  const cause = asCause(top?.cause)
  // undici nests one deeper: TypeError: fetch failed -> cause: SocketError
  const deepest = asCause(cause?.cause)
  return {
    at: at.toISOString(),
    url,
    name: text(top?.name) ?? 'Error',
    message: text(top?.message) ?? String(error).slice(0, 300),
    ...(text(cause?.code) ? { code: text(cause?.code) as string } : {}),
    ...(text(cause?.errno) ? { errno: String(cause?.errno) } : {}),
    ...(text(cause?.syscall) ? { syscall: text(cause?.syscall) as string } : {}),
    ...(text(cause?.hostname) ? { hostname: text(cause?.hostname) as string } : {}),
    ...(text(deepest?.code) ? { causeCode: text(deepest?.code) as string } : {}),
    ...(text(deepest?.message) ? { causeMessage: text(deepest?.message) as string } : {}),
  }
}

/** One line naming the failure, for a notice or a log. */
export function formatFailure(failure: FetchFailure): string {
  const parts = [failure.code ?? failure.causeCode ?? failure.name]
  if (failure.syscall !== undefined) parts.push(failure.syscall)
  if (failure.hostname !== undefined) parts.push(failure.hostname)
  if (failure.status !== undefined) parts.push(`HTTP ${failure.status}`)
  return parts.join(' ')
}

let lastFailure: FetchFailure | null = null

/** The most recent transport failure this process saw, if any. */
export function lastFetchFailure(): FetchFailure | null {
  return lastFailure
}

/**
 * Wrap the global fetch so transport failures are recorded. Idempotent: a second
 * call is a no-op, so a loop that re-enters does not stack wrappers.
 */
export function installFetchDiagnostics(sink?: (failure: FetchFailure) => void): void {
  const existing = globalThis.fetch as typeof fetch & { __treadleDiagnostics?: true }
  if (existing.__treadleDiagnostics === true) return

  const wrapped = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    try {
      const response = await existing(input, init)
      if (!response.ok) {
        // A refusal that never reached the model still explains a pass.
        lastFailure = {
          at: new Date().toISOString(),
          url,
          name: `HTTP ${response.status}`,
          message: response.statusText,
          status: response.status,
        }
        sink?.(lastFailure)
      }
      return response
    } catch (error) {
      lastFailure = describeFailure(error, url)
      sink?.(lastFailure)
      throw error
    }
  }
  ;(wrapped as typeof fetch & { __treadleDiagnostics?: true }).__treadleDiagnostics = true
  globalThis.fetch = wrapped
}
