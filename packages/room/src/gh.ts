import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { isRecord } from "@autotelic/board"
import { parseJson, run } from "./shell.ts"

/*
 * GitHub, through the person's own `gh`.
 *
 * Identity is the token's, not `git config`'s: this machine has more than one account, and
 * posting a bot review as the wrong one is the collision that matters. `doctor` compares
 * the token's login to the room's stage and refuses to start the daemon when they differ.
 */

export const authLogin = (): string | undefined => {
  const result = run({ command: "gh", args: ["api", "user", "--jq", ".login"] })
  const login = result.stdout.trim()
  return result.code === 0 && login !== "" ? login : undefined
}

export const authOk = (): boolean => run({ command: "gh", args: ["auth", "status"] }).code === 0

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

export const pullRequest = (number: number, cwd: string): PullRequest | undefined => {
  const result = run({
    command: "gh",
    args: [
      "pr",
      "view",
      String(number),
      "--json",
      "number,title,body,author,headRefOid,baseRefOid,additions,deletions,files,isDraft",
    ],
    cwd,
  })
  if (result.code !== 0) return undefined
  const value = parseJson(result.stdout)
  if (!isRecord(value)) return undefined
  const author = isRecord(value.author) ? value.author.login : undefined
  const files = Array.isArray(value.files)
    ? value.files.flatMap((file) =>
        isRecord(file) && typeof file.path === "string" ? [file.path] : [],
      )
    : []
  return {
    number: typeof value.number === "number" ? value.number : number,
    title: typeof value.title === "string" ? value.title : "",
    body: typeof value.body === "string" ? value.body : "",
    author: typeof author === "string" ? author : "",
    headRefOid: typeof value.headRefOid === "string" ? value.headRefOid : "",
    baseRefOid: typeof value.baseRefOid === "string" ? value.baseRefOid : "",
    additions: typeof value.additions === "number" ? value.additions : 0,
    deletions: typeof value.deletions === "number" ? value.deletions : 0,
    files,
    isDraft: value.isDraft === true,
  }
}

export const postReview = (
  number: number,
  body: string,
  cwd: string,
): { readonly ok: boolean; readonly message: string } => {
  const result = run({
    command: "gh",
    args: ["pr", "review", String(number), "--comment", "--body", body],
    cwd,
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
 */
export const hasReviewMarker = ({
  number,
  owner,
  name,
  marker,
  cwd,
}: {
  readonly number: number
  readonly owner: string
  readonly name: string
  readonly marker: string
  readonly cwd: string
}): boolean => {
  const result = run({
    command: "gh",
    args: [
      "api",
      `repos/${owner}/${name}/pulls/${number}/reviews`,
      "--paginate",
      "--jq",
      ".[].body",
    ],
    cwd,
  })
  return result.code === 0 && result.stdout.includes(marker)
}

/** The Linear token is read by `linearis`, not by the room; presence is all we check. */
export const linearTokenPresent = (): boolean =>
  existsSync(join(homedir(), ".linearis", "token")) ||
  existsSync(join(homedir(), ".linear_api_token"))
