import { Effect, FileSystem, Path } from "effect"
import { globSource } from "./glob.ts"

/**
 * Gitignore matching, because a hand-written list of other tools' output
 * directories is a bound that fails OPEN.
 *
 * `policy.ignoredDirectories` knew about dist, build, out, coverage, .next,
 * .turbo, .vercel and .cache. It did not know about `.wrangler`, which is where
 * Cloudflare's build output goes. On one repository that produced 52 findings
 * from 10 generated files -- 27% of the whole report, 49 of them from a single
 * bundled dev server -- and every one of them was confidently, uselessly true.
 *
 * A list of other people's output directories cannot be kept current. A
 * .gitignore already is current, because the tool that produced the output wrote
 * it. Gitignored files are by definition not source, and this program analyses
 * source.
 *
 * The subset implemented here is the one that matters for that purpose: names,
 * globs, `**`, anchoring, trailing slashes, negation, and "a later .gitignore
 * wins". Git's full semantics around `\` escapes and character classes are not
 * here; a pattern this cannot parse is skipped rather than misread, and the
 * files it would have matched stay in the analysis, which is the safe direction.
 */
export interface IgnoreRule {
  /** The directory holding the .gitignore this came from. */
  readonly base: string
  readonly regex: RegExp
  readonly negated: boolean
  /** How far below the root, so a deeper file's rules can be applied later. */
  readonly depth: number
}

/**
 * One pattern to one regex, over a path relative to the pattern's directory.
 *
 * Returns undefined for the forms this deliberately does not handle, so the
 * caller skips them instead of guessing: a rule nobody can predict is worse than
 * a rule that is not there.
 */
const toRegExp = (pattern: string): RegExp | undefined => {
  let body = pattern
  if (body.startsWith("/")) body = body.slice(1)
  const directoryOnly = body.endsWith("/")
  if (directoryOnly) body = body.slice(0, -1)
  if (body === "") return undefined

  const hasSlash = body.includes("/")
  // A pattern with no slash matches at any depth; one with a slash is anchored
  // to the .gitignore's own directory. Git ignores a matched directory and
  // everything below it, which is what the trailing group does.
  const prefix = hasSlash || pattern.startsWith("/") ? "^" : "(?:^|.*/)"
  return new RegExp(
    prefix + globSource(body, { question: true, doubleStarSkipsSlash: true }) + "(?:/.*)?$",
  )
}

/** Gitignore text, the directory it came from, and its depth in the walk. */
interface GitignoreText {
  readonly text: string
  readonly base: string
  readonly depth: number
}

/** Parse gitignore lines into rules, relative to the file's directory. */
export const parseGitignore = ({ text, base, depth }: GitignoreText): ReadonlyArray<IgnoreRule> => {
  const rules: Array<IgnoreRule> = []
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "")
    if (line === "" || line.startsWith("#")) continue
    const negated = line.startsWith("!")
    const regex = toRegExp(negated ? line.slice(1) : line)
    if (regex !== undefined) rules.push({ base, depth, regex, negated })
  }
  return rules
}

/** Shallowest first, so a deeper .gitignore overrides a higher one. */
export const orderRules = (rules: ReadonlyArray<IgnoreRule>): ReadonlyArray<IgnoreRule> =>
  [...rules].sort((left, right) => left.depth - right.depth)

/** Whether a path is ignored: the last matching rule wins, as git decides it. */
export const isIgnored = (
  rules: ReadonlyArray<IgnoreRule>,
  absolute: string,
  path: Path.Path,
): boolean => {
  let ignored = false
  for (const rule of rules) {
    const relative = path.relative(rule.base, absolute)
    // A rule only speaks for its own directory and below it.
    if (relative === "" || relative.startsWith("..")) continue
    if (rule.regex.test(relative)) ignored = !rule.negated
  }
  return ignored
}

/** The .gitignore in one directory, if it has one. */
export const rulesAt = (
  directory: string,
  depth: number,
): Effect.Effect<ReadonlyArray<IgnoreRule>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(directory, ".gitignore")
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return []
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    return parseGitignore({ text, base: directory, depth })
  })
