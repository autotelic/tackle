import { createHash } from "node:crypto"
import { Option, pipe, Result, Schema } from "effect"

/*
 * Resuming a room after the machine was off.
 *
 * A durable conversation is not a durable subscription. GitHub keeps the reviews, the room keeps
 * the talk, and nothing here keeps a watermark -- so a cold start cannot tell "nothing happened"
 * from "I was asleep for six hours". This module is the watermark: what this machine last saw,
 * per pull request, and the diff against what GitHub says now.
 *
 * Three facts shape the record, all measured against a real repository:
 *   - a review has no `updated_at`, so an edited body is invisible to any timestamp; only a body
 *     hash sees it;
 *   - a comment's `updated_at` carries a one-second skew on creation, so "updated > created" is
 *     not an edit signal;
 *   - a state change mutates the same review id (a dismissal keeps its id), so an id watermark
 *     alone never sees it.
 * Hence `recent`: a capped map of the last ids to their state and body hash. `id > lastId` stays
 * the cheap first pass; `recent` is what catches edits and dismissals in the tail.
 */

/** A body folded to something that changes when the text does. */
export const bodyHash = (body: string): string =>
  createHash("sha256").update(body).digest("hex").slice(0, 16)

/** What the cursor remembers about one review or comment id. */
export const Remembered = Schema.Struct({
  state: Schema.optionalKey(Schema.String),
  bodyHash: Schema.String,
})

/** What this machine last saw of one pull request. */
export const PrCursor = Schema.Struct({
  lastReviewId: Schema.Finite,
  lastCommentId: Schema.Finite,
  seenSha: Schema.String,
  seenAt: Schema.Finite,
  /**
   * The head sha this machine has already reported as waiting on a re-request.
   *
   * The fact ("changes requested at an older commit, head moved, nobody re-asked") is a state,
   * not news, so without this it would be reported on every resume forever.
   */
  reRequestedSha: Schema.optionalKey(Schema.String),
  /** The tail: id -> what it said and meant when seen. Capped, oldest dropped first. */
  recent: Schema.optionalKey(Schema.Record(Schema.String, Remembered)),
})

/** The whole watermark. */
export const Cursor = Schema.Struct({
  version: Schema.Literal(1),
  seenAt: Schema.Finite,
  prs: Schema.Record(Schema.String, PrCursor),
})

export type Cursor = typeof Cursor.Type
export type PrCursor = typeof PrCursor.Type

/** How many ids per pull request are remembered for edit and dismissal detection. */
const TAIL = 50

export const emptyCursor: Cursor = { version: 1, seenAt: 0, prs: {} }

/** A review, as GitHub reports it. */
export interface Review {
  readonly id: number
  readonly state: string
  /** The commit the review was written against: what makes "stale" answerable. */
  readonly commitId: string
  readonly body: string
  readonly author: string
  /** ISO instant, so a cold start can say which round is the latest one. */
  readonly submittedAt: string
}

/** An inline review comment, as GitHub reports it. */
export interface Comment {
  readonly id: number
  readonly body: string
  readonly path: string
  readonly line: number
  readonly author: string
  readonly createdAt: string
}

/** One pull request as this run observed it. */
export interface Observation {
  readonly pr: number
  readonly headSha: string
  readonly reviews: ReadonlyArray<Review>
  readonly comments: ReadonlyArray<Comment>
}

/** What resume found for one pull request. */
export interface ResumeCard {
  /** Deterministic, so a re-run with nothing new is refused by the ledger's own dedupe. */
  readonly id: string
  readonly pr: number
  readonly text: string
}

/** The whole plan: the cards to post, and the watermark to store once they are. */
export interface ResumePlan {
  readonly cards: ReadonlyArray<ResumeCard>
  readonly next: Cursor
  /** True when there was no watermark: the plan says so rather than claiming all is well. */
  readonly lost: boolean
}

const markOf = (state: string): string => {
  const folded = state.trim().toLowerCase().replaceAll("_", " ")
  if (folded === "approved") return "approved"
  if (folded === "changes requested") return "changes requested"
  if (folded === "dismissed") return "dismissed"
  return folded === "" ? "unknown" : folded
}

const short = (sha: string): string => (sha === "" ? "unknown" : sha.slice(0, 8))

/**
 * The latest review: `submittedAt` orders them, and the id breaks a tie on one instant.
 *
 * An `Option`, not `Review | undefined`: a PR with no reviews and a PR whose reviews could not
 * be read are the same absence here, and the plumb rule that caught this the first time is right
 * that absence is not a value.
 */
const latestReview = (reviews: ReadonlyArray<Review>): Option.Option<Review> =>
  Option.fromUndefinedOr(
    [...reviews]
      .sort((left, right) =>
        left.submittedAt === right.submittedAt
          ? right.id - left.id
          : left.submittedAt.localeCompare(right.submittedAt),
      )
      .at(-1),
  )

/** The review state that asks for another pass. */
const asksForChanges = (review: Review): boolean => markOf(review.state) === "changes requested"

/** A review written at a commit the head has since left. */
const reviewedBefore =
  (head: string) =>
  (review: Review): boolean =>
    review.commitId !== "" && review.commitId !== head

/** This head has not already been reported as waiting on a re-request. */
const notReported = (previous: PrCursor | undefined, head: string) => (): boolean =>
  previous?.reRequestedSha !== head

/**
 * The review that is owed a re-request, or none.
 *
 * GitHub does not ask again when the head moves: a `synchronize` hook covers a push that emits
 * the event, and nothing covers the head changing without one (an amended push from another
 * machine, a recreated branch, a review left on an older sha). The state is right there in the
 * API -- the latest review asks for changes at a commit that is not the head -- so resume can
 * name it instead of leaving the author to remember.
 *
 * Reported once per head: the fact does not change until someone re-requests or reviews, and a
 * card that repeats forever is one people learn to skip.
 *
 * @param input - The observation and the cursor for this PR.
 * @returns The review to re-request from, when that obligation is outstanding and unreported.
 */
const owedReRequest = (input: {
  readonly observation: Observation
  readonly previous: PrCursor | undefined
}): Option.Option<Review> => {
  const head = input.observation.headSha
  return pipe(
    latestReview(input.observation.reviews),
    Option.filter(asksForChanges),
    Option.filter(reviewedBefore(head)),
    Option.filter(notReported(input.previous, head)),
  )
}

/** What folding one observation produced. A named contract, not an anonymous shape. */
export interface Folded {
  readonly card: ResumeCard | undefined
  readonly next: PrCursor
}

const remember = (previous: PrCursor | undefined): Map<string, typeof Remembered.Type> =>
  new Map(Object.entries(previous?.recent ?? {}))

/**
 * Fold one observation into a card and the next watermark.
 *
 * One card per pull request, never a turn: a catch-up must not start a model run. It carries the
 * review states, the inline-comment delta (an approval with notes is not done), and whether the
 * head has moved since the review was written -- the difference between "Ed asked for this" and
 * "Ed asked for this and it is already fixed".
 *
 * @param input - The observation, the previous cursor for this PR, and the instant.
 * @returns The card (when there is news) and the next cursor entry.
 */
export const foldObservation = (input: {
  readonly observation: Observation
  readonly previous: PrCursor | undefined
  readonly now: number
}): Folded => {
  const { observation, previous, now } = input
  const owed = owedReRequest({ observation, previous })
  const pending = Option.isSome(owed)
  const recent = remember(previous)
  const lastReviewId = previous?.lastReviewId ?? 0
  const lastCommentId = previous?.lastCommentId ?? 0

  const reviewNews = observation.reviews.filter((review) => {
    const known = recent.get("review:" + String(review.id))
    if (known === undefined) return review.id > lastReviewId
    // An edit has no timestamp and a dismissal keeps the id: both are news.
    return known.bodyHash !== bodyHash(review.body) || known.state !== review.state
  })
  const commentNews = observation.comments.filter((comment) => {
    const known = recent.get("comment:" + String(comment.id))
    if (known === undefined) return comment.id > lastCommentId
    return known.bodyHash !== bodyHash(comment.body)
  })

  for (const review of observation.reviews) {
    recent.set("review:" + String(review.id), {
      state: review.state,
      bodyHash: bodyHash(review.body),
    })
  }
  for (const comment of observation.comments) {
    recent.set("comment:" + String(comment.id), { bodyHash: bodyHash(comment.body) })
  }
  // Keep the tail bounded, dropping the lowest ids: a watermark has already passed them.
  const byNewest = (left: string, right: string) =>
    Number(right.split(":")[1] ?? 0) - Number(left.split(":")[1] ?? 0)
  const tail = Object.fromEntries(
    [...recent.entries()].sort(([left], [right]) => byNewest(left, right)).slice(0, TAIL),
  )
  const watermark: PrCursor = {
    lastReviewId: observation.reviews.reduce(
      (high, review) => Math.max(high, review.id),
      lastReviewId,
    ),
    lastCommentId: observation.comments.reduce(
      (high, comment) => Math.max(high, comment.id),
      lastCommentId,
    ),
    seenSha: observation.headSha,
    seenAt: now,
    recent: tail,
  }
  // Reported-per-head is the difference between a state and news: without it, "pushed and
  // nobody re-asked" would be a card on every resume until the review changes.
  const next: PrCursor = pending ? { ...watermark, reRequestedSha: observation.headSha } : watermark
  // A cold start has no delta to report, so reporting every review a PR ever had is not news a
  // person can act on (5 reviews and 42 notes on one PR). It reports the *current* round instead:
  // the latest review, its state and sha, and the notes written after it.
  if (previous === undefined) {
    const latest = latestReview(observation.reviews)
    const after = Option.match(latest, {
      onNone: () => observation.comments.length,
      onSome: (review) =>
        observation.comments.filter((comment) => comment.createdAt >= review.submittedAt).length,
    })
    if (Option.isNone(latest)) return { card: undefined, next }
    const review = latest.value
    const text =
      "#" +
      String(observation.pr) +
      " · cursor lost · latest: " +
      markOf(review.state) +
      " at " +
      short(review.commitId) +
      " (head " +
      short(observation.headSha) +
      ")" +
      (after === 0 ? "" : " · " + String(after) + " inline note(s) after it") +
      (pending ? " · no re-request since the push" : "")
    return {
      card: {
        id: "resume:" + String(observation.pr) + ":first:" + String(next.lastReviewId),
        pr: observation.pr,
        text,
      },
      next,
    }
  }
  if (reviewNews.length === 0 && commentNews.length === 0) {
    // Silence is the failure this exists for: nothing new to say, the author believes the
    // reviewer is looking, and GitHub will not ask again on its own.
    if (!pending) return { card: undefined, next }
    return {
      card: {
        id: "resume:" + String(observation.pr) + ":rerequest:" + short(observation.headSha),
        pr: observation.pr,
        text:
          "#" +
          String(observation.pr) +
          " · changes requested at " +
          Option.match(owed, {
            onNone: () => "",
            onSome: (review) => short(review.commitId),
          }) +
          ", head is now " +
          short(observation.headSha) +
          " · no re-request since the push",
      },
      next,
    }
  }

  const parts: Array<string> = []
  if (reviewNews.length > 0) {
    const states = [...new Set(reviewNews.map((review) => markOf(review.state)))].join(", ")
    parts.push(String(reviewNews.length) + " new review(s) (" + states + ")")
  }
  if (commentNews.length > 0) parts.push(String(commentNews.length) + " inline note(s)")
  // The stale note is the field that stops settled work being re-litigated.
  const staleOf = reviewNews.find((review) => review.commitId !== observation.headSha)
  const stale =
    staleOf === undefined
      ? ""
      : " written at " + short(staleOf.commitId) + ", head is now " + short(observation.headSha)
  const moved =
    staleOf === undefined &&
    previous !== undefined &&
    previous.seenSha !== "" &&
    previous.seenSha !== observation.headSha
      ? " head moved since this machine last looked"
      : ""
  const ids = [...reviewNews, ...commentNews]
    .slice(0, 4)
    .map((item) => "#" + String(item.id))
    .join(" ")
  const text =
    "#" +
    String(observation.pr) +
    " · " +
    parts.join(" · ") +
    stale +
    moved +
    (pending ? " · no re-request since the push" : "") +
    (ids === "" ? "" : " · " + ids)
  return {
    card: {
      id:
        "resume:" +
        String(observation.pr) +
        ":" +
        String(next.lastReviewId) +
        ":" +
        String(next.lastCommentId) +
        ":" +
        String(reviewNews.length) +
        ":" +
        String(commentNews.length),
      pr: observation.pr,
      text,
    },
    next,
  }
}

/**
 * Plan a resume over every observed pull request.
 *
 * @param input - The observations, the stored cursor (or none), and the instant.
 * @returns The cards, the next cursor, and whether the watermark was missing.
 */
export const planResume = (input: {
  readonly observations: ReadonlyArray<Observation>
  readonly cursor: Cursor | undefined
  readonly now: number
}): ResumePlan => {
  const cards: Array<ResumeCard> = []
  const prs = new Map(Object.entries(input.cursor?.prs ?? {}))
  for (const observation of input.observations) {
    const folded = foldObservation({
      observation,
      previous: input.cursor?.prs[String(observation.pr)],
      now: input.now,
    })
    if (folded.card !== undefined) cards.push(folded.card)
    prs.set(String(observation.pr), folded.next)
  }
  return {
    cards,
    next: { version: 1, seenAt: input.now, prs: Object.fromEntries(prs) },
    // No stored watermark and an empty one are the same situation: this machine has not looked.
    lost: input.cursor === undefined || Object.keys(input.cursor.prs).length === 0,
  }
}

/** The line a person reads before the cards. */
export const renderResume = (input: {
  readonly plan: ResumePlan
  readonly applied: boolean
}): string => {
  const head = input.plan.lost
    ? "room resume: cursor lost; reporting the full state as news"
    : input.plan.cards.length === 0
      ? "room resume: nothing new since this machine last looked"
      : "room resume: " + String(input.plan.cards.length) + " pull request(s) with news"
  const tail = input.plan.cards.length === 0 ? [] : input.plan.cards.map((card) => "  " + card.text)
  const wrote = input.applied ? ["", "cards appended; the cursor advanced"] : []
  return [head, ...tail, ...wrote].join("\n")
}

/**
 * Read the cursor. A malformed file decodes to the empty cursor: a stale artifact degrades to
 * silence, never to a false finding, and the empty cursor is the same state as never having one.
 */
export const decodeCursor = (text: string): Cursor =>
  Result.getOrElse(Schema.decodeResult(Schema.fromJsonString(Cursor))(text), () => emptyCursor)

/** The cursor file for a room: machine state, beside the session and outside the checkout. */
export const cursorFile = (input: { readonly stateDir: string }): string =>
  input.stateDir + "/resume.json"

/** A JSON array from `gh`, one row at a time: one malformed row must not lose the rest. */
const rows = (text: string): ReadonlyArray<Schema.Json> =>
  Result.getOrElse(
    Schema.decodeResult(Schema.fromJsonString(Schema.Array(Schema.Json)))(text),
    () => [],
  )

const PullSummary = Schema.Struct({ number: Schema.Finite })
const PullHead = Schema.Struct({ head: Schema.Struct({ sha: Schema.String }) })
const ReviewJson = Schema.Struct({
  id: Schema.Finite,
  state: Schema.String,
  commit_id: Schema.optionalKey(Schema.String),
  submitted_at: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.optionalKey(Schema.Struct({ login: Schema.String })),
})
const CommentJson = Schema.Struct({
  id: Schema.Finite,
  body: Schema.optionalKey(Schema.NullOr(Schema.String)),
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  created_at: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.Struct({ login: Schema.String })),
})

const reviewOf = (row: Schema.Json): ReadonlyArray<Review> => {
  const decoded = Result.getOrUndefined(Schema.decodeUnknownResult(ReviewJson)(row))
  return decoded === undefined
    ? []
    : [
        {
          id: decoded.id,
          state: decoded.state,
          commitId: decoded.commit_id ?? "",
          body: decoded.body ?? "",
          author: decoded.user?.login ?? "",
          submittedAt: decoded.submitted_at ?? "",
        },
      ]
}

const commentOf = (row: Schema.Json): ReadonlyArray<Comment> => {
  const decoded = Result.getOrUndefined(Schema.decodeUnknownResult(CommentJson)(row))
  return decoded === undefined
    ? []
    : [
        {
          id: decoded.id,
          body: decoded.body ?? "",
          path: decoded.path ?? "",
          line: decoded.line ?? 0,
          author: decoded.user?.login ?? "",
          createdAt: decoded.created_at ?? "",
        },
      ]
}

/** Read GitHub for the pull requests this resume should consider. */
export const observe = (input: {
  readonly repo: string
  readonly only: ReadonlyArray<number>
  readonly limit: number
  readonly gh: (args: ReadonlyArray<string>) => string | undefined
}): ReadonlyArray<Observation> => {
  const numbers =
    input.only.length > 0
      ? input.only
      : rows(
          input.gh([
            "api",
            "repos/" + input.repo + "/pulls?state=open&per_page=" + String(input.limit),
          ]) ?? "[]",
        ).flatMap((row) => {
          const decoded = Result.getOrUndefined(Schema.decodeUnknownResult(PullSummary)(row))
          return decoded === undefined ? [] : [decoded.number]
        })
  return numbers.flatMap((pr) => {
    const head = Result.getOrUndefined(
      Schema.decodeResult(Schema.fromJsonString(PullHead))(
        input.gh(["api", "repos/" + input.repo + "/pulls/" + String(pr)]) ?? "{}",
      ),
    )
    if (head === undefined) return []
    const path = "repos/" + input.repo + "/pulls/" + String(pr)
    return [
      {
        pr,
        headSha: head.head.sha,
        reviews: rows(input.gh(["api", path + "/reviews?per_page=100"]) ?? "[]").flatMap(reviewOf),
        comments: rows(input.gh(["api", path + "/comments?per_page=100"]) ?? "[]").flatMap(
          commentOf,
        ),
      },
    ]
  })
}
