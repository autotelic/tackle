/**
 * Provider failures (#9): errors from the model provider — HTTP status
 * errors, rate limits, insufficient funds, network and auth failures — are
 * infrastructure failures, so they Pause the Loop instead of burning an
 * issue's budget. Loop-caused failures (turn cap, session timeout, abort)
 * and agent-level failures never match.
 *
 * Classification is deterministic where the error carries structure:
 * a leading "NNN:" status classifies by table (4xx provider-side codes,
 * 5xx range), and pi's own APIError class strings match exactly. Free-form
 * text falls back to narrow provider-specific tokens only — the audit of
 * the 2026-11 forestbuilder logs showed the classes that actually occur
 * are the status-prefixed ones, "Connection error." and "Request timed
 * out." — the latter two were MISSED by the old prose regexes, so those
 * passes burned budget instead of Pausing.
 */

/** pi APIError class strings, matched exactly (lowercased). */
const PROVIDER_ERROR_CLASSES = new Set(['connection error.', 'request timed out.'])

/** 4xx codes that are the provider's fault, not the caller's. */
const PROVIDER_4XX = new Set([401, 402, 403, 408, 429])

/** The SDK renders provider API errors as "402: {...}" / "429: {...}". */
const STATUS_PREFIX = /^(\d{3}):/

/** Provider-specific tokens for errors that carry no status code. */
const PROVIDER_TOKENS = [
  /\bECONN\w*\b/,
  /\bETIMEDOUT\b/,
  /\bENET\w*\b/,
  /\bfetch failed\b/i,
  /\bsocket hang up\b/i,
  /\binsufficient (?:account )?funds\b/i,
  /\brate.?limit\b/i,
  /\boverloaded\b/i,
  /\binvalid api key\b/i,
  /\bunauthorized\b/i,
]

/** Leading HTTP status of an error string, or null. */
export function providerStatusCode(reason: string): number | null {
  const match = STATUS_PREFIX.exec(reason)
  return match ? Number(match[1]) : null
}

export function isProviderFailure(reason: string | undefined): boolean {
  if (!reason) return false
  const lowered = reason.toLowerCase()
  // Loop-caused kills never classify as provider, whatever they contain (#9).
  if (
    reason.startsWith('turn cap') ||
    reason.startsWith('turn backstop') ||
    reason.startsWith('session timeout') ||
    reason.startsWith('session $ cap') ||
    lowered.startsWith('this operation was aborted')
  ) {
    return false
  }
  const status = providerStatusCode(reason)
  if (status !== null) return status >= 500 || PROVIDER_4XX.has(status)
  if (PROVIDER_ERROR_CLASSES.has(lowered)) return true
  return PROVIDER_TOKENS.some((pattern) => pattern.test(reason))
}
