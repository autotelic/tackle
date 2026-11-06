/**
 * Provider failures (#9): errors from the model provider — HTTP status
 * errors, rate limits, insufficient funds, network and auth failures — are
 * infrastructure failures, so they Pause the Loop instead of burning an
 * issue's budget. Loop-caused failures (turn cap, session timeout, abort)
 * and agent-level failures never match.
 */
const PROVIDER_PATTERNS = [
  /^\d{3}[: ]/, // "402: {...}", "500: ..."
  /\b(4\d\d|5\d\d)\b.*(error|failed)/i,
  /insufficient (account )?funds/i,
  /rate.?limit/i,
  /overloaded/i,
  /capacity/i,
  /\bECONN\w*\b/,
  /\bETIMEDOUT\b/,
  /\bENET\w*\b/,
  /fetch failed/i,
  /socket hang up/i,
  /invalid api key/i,
  /unauthorized/i,
  /forbidden/i,
  /authentication/i,
]

export function isProviderFailure(reason: string | undefined): boolean {
  if (!reason) return false
  if (reason.startsWith('turn cap') || reason.startsWith('session timeout')) return false
  return PROVIDER_PATTERNS.some((pattern) => pattern.test(reason))
}
