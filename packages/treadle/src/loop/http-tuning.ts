/**
 * Tune the HTTP dispatcher the SDK's model calls go through.
 *
 * The loop's provider failures were diagnosed as `ERR_HTTP2_INVALID_SESSION`:
 * a pooled HTTP/2 session the server had already discarded gets handed to the
 * next request, which then fails instantly — and every later request in that
 * process fails the same way (22 passes, 66 retries, zero recoveries; only a
 * restart cured it). The SDK ships a dispatcher configured for this
 * (`allowH2: false`, bounded body/header timeouts), but only its own CLI
 * installs it; the embedded SDK path treadle uses never did.
 *
 * The helper is not exported from the package root, and the exports map blocks
 * deep subpath imports — but resolving the root entry and walking to the file
 * bypasses that, without vendoring or patching the dependency.
 *
 * Best effort by design: if a future version moves the file, the loop keeps its
 * existing safety net (a session that never left the process exits at once and
 * KeepAlive restarts it), so this can only help.
 */

export type HttpTuning = 'configured' | 'unavailable'

export async function tuneHttpDispatcher(idleTimeoutMs = 120_000): Promise<HttpTuning> {
  try {
    const root = import.meta.resolve('@earendil-works/pi-coding-agent')
    const url = new URL('./core/http-dispatcher.js', root)
    const mod = (await import(url.href)) as {
      configureHttpDispatcher?: (timeoutMs?: number) => void
    }
    if (typeof mod.configureHttpDispatcher !== 'function') return 'unavailable'
    mod.configureHttpDispatcher(idleTimeoutMs)
    return 'configured'
  } catch {
    return 'unavailable'
  }
}
