import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Predicate, Result, Schema } from "effect"
import { run } from "./shell.ts"

/*
 * GitHub, through the person's own `gh`.
 *
 * Identity is the token's, not `git config`'s: this machine has more than one account, and
 * posting a bot review as the wrong one is the collision that matters. `doctor` compares
 * the token's login to the room's stage and refuses to start the daemon when they differ.
 */

/** The token's login. */
export const authLogin = (): Result.Result<string, string> => {
  const result = run({ command: "gh", args: ["api", "user", "--jq", ".login"] })
  const login = result.stdout.trim()
  return result.code === 0 && login !== ""
    ? Result.succeed(login)
    : Result.fail("gh is not authenticated")
}

const PullRequestJson = Schema.Struct({
  number: Schema.Finite,
  title: Schema.String,
  body: Schema.String,
  author: Schema.Struct({ login: Schema.String }),
  headRefOid: Schema.String,
  baseRefOid: Schema.String,
  additions: Schema.Finite,
  deletions: Schema.Finite,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
  isDraft: Schema.Boolean,
})

/** A pull request, as the room needs it. */
export interface PullRequest {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly author: string
  readonly headRefOid: string
  readonly baseRefOid: string
  readonly additions: number
  readonly deletions: number
  readonly files: ReadonlyArray<string>
  readonly isDraft: boolean
}

/**
 * Read one pull request.
 *
 * @param input - The PR number and the repository root.
 * @returns Some(pr) when `gh` and the schema agree, None otherwise.
 */
export const pullRequest = (input: {
  readonly number: number
  readonly cwd: string
}): Result.Result<PullRequest, string> => {
  const result = run({
    command: "gh",
    args: [
      "pr",
      "view",
      String(input.number),
      "--json",
      "number,title,body,author,headRefOid,baseRefOid,additions,deletions,files,isDraft",
    ],
    cwd: input.cwd,
  })
  if (result.code !== 0) return Result.fail(result.stderr.trim())
  const decoded = Schema.decodeResult(Schema.fromJsonString(PullRequestJson))(result.stdout)
  if (Result.isFailure(decoded)) return Result.fail("gh returned an unexpected PR shape")
  const value = decoded.success
  return Result.succeed({
    number: value.number,
    title: value.title,
    body: value.body,
    author: value.author.login,
    headRefOid: value.headRefOid,
    baseRefOid: value.baseRefOid,
    additions: value.additions,
    deletions: value.deletions,
    files: value.files.map((file) => file.path),
    isDraft: value.isDraft,
  })
}

/** The result of posting a review. */
export interface PostResult {
  readonly ok: boolean
  readonly message: string
}

/**
 * Post one review comment.
 *
 * @param input - The PR number, the body, and the repository root.
 * @returns Whether `gh` accepted it, and the message when it did not.
 */
export const postReview = (input: {
  readonly number: number
  readonly body: string
  readonly cwd: string
}): PostResult => {
  const result = run({
    command: "gh",
    args: ["pr", "review", String(input.number), "--comment", "--body", input.body],
    cwd: input.cwd,
  })
  return result.code === 0
    ? { ok: true, message: "posted" }
    : { ok: false, message: result.stderr.trim() || result.stdout.trim() || "gh failed" }
}

/**
 * Whether this head SHA already carries this room's review.
 *
 * The marker is the only durable answer: a re-request after a push must run again, and a
 * re-delivered webhook for the same SHA must not.
 *
 * @param input - The PR, the repository, the marker, and the root.
 * @returns True when a review body already contains the marker.
 */
export const hasReviewMarker: Predicate.Predicate<{
  readonly number: number
  readonly owner: string
  readonly name: string
  readonly marker: string
  readonly cwd: string
}> = (input) => {
  const result = run({
    command: "gh",
    args: [
      "api",
      `repos/${input.owner}/${input.name}/pulls/${input.number}/reviews`,
      "--paginate",
      "--jq",
      ".[].body",
    ],
    cwd: input.cwd,
  })
  return result.code === 0 && result.stdout.includes(input.marker)
}

/** Whether the Linear token is present; the room never reads it. */
export const linearTokenPresent = (): boolean =>
  existsSync(join(homedir(), ".linearis", "token")) ||
  existsSync(join(homedir(), ".linear_api_token"))
