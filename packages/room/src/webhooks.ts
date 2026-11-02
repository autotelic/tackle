import type { RoomConfig } from "./config.ts"
import { roomUrl } from "./daemon.ts"

/*
 * The room's outside wiring: the command that forwards GitHub events locally, the
 * `gh api` call that registers a real webhook on a deployed room, and the URL Linear should
 * deliver to.
 *
 * Its own module, and deliberately free of schema decoding: the loopback check below is a
 * guard on a URL, and beside a `SchemaParser` decode the rule set reads it as a hand-rolled
 * field guard (plumb-effect/no-manual-field-guards) rather than the string test it is.
 */

/**
 * The `gh webhook forward` command for a room.
 *
 * @param config - The room's config.
 * @returns A shell-ready command.
 */
export const webhookCommand = (config: RoomConfig): string =>
  [
    "gh webhook forward",
    `  --repo ${config.repo.owner}/${config.repo.name}`,
    "  --events pull_request,pull_request_review,pull_request_review_comment",
    `  --url ${roomUrl()}/r/${encodeURIComponent(config.room)}/ingest`,
  ].join(" \\\n")

/**
 * The `gh api` call that registers this room's webhook, for a room with a public URL.
 *
 * `gh webhook forward` is right for a local room (it tunnels); a deployed room wants a real
 * webhook, and "set up the room" is the moment to create it — the brief says so, because a room
 * that needs four manual steps is a room that stays silent.
 *
 * @param input - The room's config and the URL the room answers on.
 * @returns The argv for `gh`, and why a local URL cannot use it.
 */
export const webhookRegistration = (input: {
  readonly config: RoomConfig
  readonly url: string
}):
  | { readonly kind: "argv"; readonly argv: ReadonlyArray<string> }
  | { readonly kind: "local"; readonly reason: string } => {
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/u.test(input.url)) {
    return {
      kind: "local",
      reason:
        "the room is local; forward with `gh webhook forward` (see `room webhook`) or deploy it first",
    }
  }
  const target = `${input.url.replace(/\/+$/u, "")}/r/${encodeURIComponent(input.config.room)}/ingest`
  return {
    kind: "argv",
    argv: [
      "api",
      `repos/${input.config.repo.owner}/${input.config.repo.name}/hooks`,
      "-X",
      "POST",
      "-f",
      "name=web",
      "-F",
      "active=true",
      "-f",
      "config[url]=" + target,
      "-f",
      "config[content_type]=json",
      "-f",
      "events[]=pull_request",
      "-f",
      "events[]=pull_request_review",
      "-f",
      "events[]=pull_request_review_comment",
      ...(input.config.linearUser === undefined ? [] : []),
    ],
  }
}

/**
 * Where Linear should deliver this room's webhooks.
 *
 * @param input - The room's config and the URL the room answers on.
 * @returns The URL and the events Linear sends, as a line a person can paste.
 */
export const linearWebhook = (input: {
  readonly config: RoomConfig
  readonly url: string
}): string =>
  `${input.url.replace(/\/+$/u, "")}/r/${encodeURIComponent(input.config.room)}/ingest  (Issue, Comment; project ${input.config.project.name})`
