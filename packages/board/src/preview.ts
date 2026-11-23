/* oxlint-disable plumb-effect/guarded-op-must-return-effect -- absence here is "this request is not a preview", not a failure with a reason; bind.ts states the same case for a wildcard host */
/* oxlint-disable plumb-effect/prefer-option-pipeline -- prefix and trailing-slash are independent guards, and the guards read more plainly than a lifted predicate chain */
import { Option } from "effect"
import type { ServiceObservation } from "@autotelic/room/Service"

/*
 * One stable preview route per room service.
 *
 * Slice 2c of docs/environment-plan.md: the shop routes `/preview/<workstream>/` to the one
 * service a room declares. The route is keyed by the workstream, not the leased port, so a room
 * recreated on another number keeps the same URL, and the router resolves the current lease on
 * every request instead of baking one into the document.
 *
 * It is a same-origin path, not an absolute URL: the board does not know which address a reader
 * reached it on (the one-shot `board presence` has no bind at all), and a guessed hostname would
 * be a fact nobody observed. A renderer resolves the path against the origin that served it.
 *
 * A route is advertised only for a service a probe found `healthy`. An unhealthy or stopped
 * service exists but does not answer, and a preview that cannot be opened is not a preview.
 */

/** The prefix every preview route shares. */
export const previewPrefix = "/preview/"

/** The board's stable route for one workstream's service. */
export const previewRoute = (workstream: string): string =>
  previewPrefix + encodeURIComponent(workstream) + "/"

/**
 * The preview a workstream may advertise, if a probe observed its service answering.
 *
 * At most one service exists per workstream today, so one healthy answer is the whole condition.
 * Multi-service routing is a later slice; until then a workstream has one route or none.
 *
 * @param input - the workstream id and the services observed for its worktree.
 * @returns the route when one observation is `healthy`, otherwise none.
 */
export const previewOf = (input: {
  readonly workstream: string
  readonly services: ReadonlyArray<Pick<ServiceObservation, "status">>
}): Option.Option<string> =>
  input.workstream !== "" && input.services.some((service) => service.status === "healthy")
    ? Option.some(previewRoute(input.workstream))
    : Option.none()

/** One preview request, split for the router: the encoded workstream and the path to forward. */
export interface PreviewRequest {
  readonly segment: string
  readonly path: string
}

/**
 * Split a request target into what the preview router needs.
 *
 * The workstream segment stays encoded so it is compared with `previewRoute`'s own encoding
 * instead of decoded here: a malformed escape is then simply a route no workstream named, not an
 * exception in the request path. The trailing slash is part of the route, so a request without it
 * is not a preview — there is nothing to resolve a relative link against.
 *
 * @param url - the request target as Node's handler receives it.
 * @returns the encoded workstream and the forwarded path, or none when this is not a preview.
 */
export const previewRequestOf = (url: string): Option.Option<PreviewRequest> => {
  const parsed = new URL(url, "http://board.invalid")
  if (!parsed.pathname.startsWith(previewPrefix)) return Option.none()
  const rest = parsed.pathname.slice(previewPrefix.length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return Option.none()
  return Option.some({ segment: rest.slice(0, slash), path: rest.slice(slash) + parsed.search })
}
