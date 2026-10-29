import { Effect, Result, Schema } from "effect"

/*
 * Webhooks into events.
 *
 * This is a trust boundary: the body is whatever GitHub or Linear sent. `Schema` is the
 * decoder, not a pile of `typeof` guards — and `decodeUnknownResult` keeps the mismatch
 * evidence instead of throwing it away (plumb/no-decode-unknown-option).
 *
 * Delivery ids are the dedupe key. GitHub retries; a retry must append no second receipt
 * and enqueue no second job.
 */

const User = Schema.Struct({ login: Schema.optionalKey(Schema.String) })

const Head = Schema.Struct({ sha: Schema.optionalKey(Schema.String) })

const PullRequest = Schema.Struct({
  number: Schema.optionalKey(Schema.Finite),
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
  draft: Schema.optionalKey(Schema.Boolean),
  merged: Schema.optionalKey(Schema.Boolean),
  user: Schema.optionalKey(User),
  head: Schema.optionalKey(Head),
  labels: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
})

const Review = Schema.Struct({
  user: Schema.optionalKey(User),
  state: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
})

const Comment = Schema.Struct({
  id: Schema.optionalKey(Schema.Finite),
  user: Schema.optionalKey(User),
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Finite),
  original_line: Schema.optionalKey(Schema.Finite),
  body: Schema.optionalKey(Schema.String),
})

const GithubPayload = Schema.Struct({
  action: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  pull_request: Schema.optionalKey(PullRequest),
  requested_reviewer: Schema.optionalKey(User),
  label: Schema.optionalKey(Schema.Struct({ name: Schema.String })),
  review: Schema.optionalKey(Review),
  comment: Schema.optionalKey(Comment),
})

const LinearState = Schema.Struct({ name: Schema.optionalKey(Schema.String) })

const LinearUser = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
})

const LinearIssue = Schema.Struct({
  identifier: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(LinearState),
  body: Schema.optionalKey(Schema.String),
  issue: Schema.optionalKey(Schema.Struct({ identifier: Schema.optionalKey(Schema.String) })),
  user: Schema.optionalKey(LinearUser),
})

const LinearPayload = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  action: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  data: Schema.optionalKey(LinearIssue),
})

export type RoomEvent =
  | {
      readonly kind: "review.requested"
      readonly id: string
      readonly at: number
      readonly pr: number
      readonly sha: string
      readonly reviewer: string
      readonly author: string
      readonly title: string
      readonly draft: boolean
    }
  | {
      readonly kind: "pr.ready"
      readonly id: string
      readonly at: number
      readonly pr: number
      readonly sha: string
      readonly author: string
      readonly labels: ReadonlyArray<string>
      readonly draft: boolean
    }
  | {
      readonly kind: "review.submitted"
      readonly id: string
      readonly at: number
      readonly pr: number
      readonly sha: string
      readonly reviewer: string
      readonly state: string
      readonly body: string
    }
  | {
      readonly kind: "thread.created"
      readonly id: string
      readonly at: number
      readonly pr: number
      readonly sha: string
      readonly author: string
      readonly path: string
      readonly line: number
      readonly commentId: number
      readonly body: string
    }
  | {
      readonly kind: "pr.closed"
      readonly id: string
      readonly at: number
      readonly pr: number
      readonly sha: string
      readonly merged: boolean
    }
  | {
      readonly kind: "comment.created"
      readonly id: string
      readonly at: number
      readonly ticket: string
      readonly author: string
      readonly body: string
    }
  | {
      readonly kind: "issue.changed"
      readonly id: string
      readonly at: number
      readonly identifier: string
      readonly state: string
    }
  | { readonly kind: "unknown"; readonly id: string; readonly at: number; readonly name: string }

/** Turn a GitHub webhook into the event the room acts on. */
export const fromGithub = ({
  event,
  delivery,
  body,
  now,
}: {
  readonly event: string
  readonly delivery: string
  readonly body: unknown
  readonly now: number
}): RoomEvent => {
  const payload = Result.getOrElse(
    Schema.decodeUnknownResult(GithubPayload)(body),
    (): typeof GithubPayload.Type => ({ action: "" }),
  )
  const action = payload.action
  const pr = payload.pull_request
  const number = pr?.number ?? 0
  const sha = pr?.head?.sha ?? ""
  const author = pr?.user?.login ?? ""

  if (event === "pull_request" && action === "review_requested") {
    return {
      kind: "review.requested",
      id: delivery,
      at: now,
      pr: number,
      sha,
      reviewer: payload.requested_reviewer?.login ?? "",
      author,
      title: pr?.title ?? "",
      draft: pr?.draft === true,
    }
  }
  if (
    event === "pull_request" &&
    (action === "opened" || action === "labeled" || action === "ready_for_review")
  ) {
    const labels = [
      ...(pr?.labels?.map((entry) => entry.name) ?? []),
      ...(payload.label?.name === undefined ? [] : [payload.label.name]),
    ]
    return {
      kind: "pr.ready",
      id: delivery,
      at: now,
      pr: number,
      sha,
      author,
      labels: [...new Set(labels)],
      draft: pr?.draft === true,
    }
  }
  if (event === "pull_request_review" && action === "submitted") {
    return {
      kind: "review.submitted",
      id: delivery,
      at: now,
      pr: number,
      sha,
      reviewer: payload.review?.user?.login ?? "",
      state: payload.review?.state ?? "",
      body: payload.review?.body ?? "",
    }
  }
  if (event === "pull_request_review_comment" && action === "created") {
    return {
      kind: "thread.created",
      id: delivery,
      at: now,
      pr: number,
      sha,
      author: payload.comment?.user?.login ?? "",
      path: payload.comment?.path ?? "",
      line: payload.comment?.line ?? payload.comment?.original_line ?? 0,
      commentId: payload.comment?.id ?? 0,
      body: payload.comment?.body ?? "",
    }
  }
  if (event === "pull_request" && action === "closed") {
    return {
      kind: "pr.closed",
      id: delivery,
      at: now,
      pr: number,
      sha,
      merged: pr?.merged === true,
    }
  }
  return { kind: "unknown", id: delivery, at: now, name: `github.${event}.${action}` }
}

/** Turn a Linear webhook into the event the room acts on. */
export const fromLinear = ({
  delivery,
  body,
  now,
}: {
  readonly delivery: string
  readonly body: unknown
  readonly now: number
}): RoomEvent => {
  const payload = Result.getOrElse(
    Schema.decodeUnknownResult(LinearPayload)(body),
    (): typeof LinearPayload.Type => ({ action: "" }),
  )
  if (payload.type === "Comment") {
    const ticket = payload.data?.issue?.identifier ?? ""
    const body = payload.data?.body ?? ""
    if (body === "") {
      return { kind: "unknown", id: delivery, at: now, name: `linear.comment.${payload.action}` }
    }
    return {
      kind: "comment.created",
      id: delivery,
      at: now,
      ticket,
      author: payload.data?.user?.name ?? payload.data?.user?.email ?? "",
      body,
    }
  }
  const identifier = payload.data?.identifier ?? ""
  if (identifier === "") {
    return { kind: "unknown", id: delivery, at: now, name: `linear.${payload.action}` }
  }
  return {
    kind: "issue.changed",
    id: delivery,
    at: now,
    identifier,
    state: payload.data?.state?.name ?? "",
  }
}
