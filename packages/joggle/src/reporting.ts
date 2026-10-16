import type { Diagnostic, Repair, Severity, SourceLocation } from "./schema.ts"
import type { Move } from "./moves.ts"
import { RuleAuthoringError } from "./schema.ts"
import { lineStarts, type SourceFile, type Unit, type Workspace } from "./workspace.ts"
import { lineAt } from "./cascade.ts"
import { finding } from "./rule.ts"

/**
 * A rule's messages, declared once and referenced by id.
 *
 * Borrowed from oxlint's `meta.messages` + `context.report({ messageId, data })`.
 * The point is the same one we already apply to questions: the wording of a
 * rule's output lives in one place, so it can be reviewed, enumerated, and pinned
 * by a test, instead of being assembled inline at every report site where nothing
 * can see the whole vocabulary.
 *
 * A `{{name}}` in a template is filled from the report's `data`.
 */
export type Messages = Readonly<Record<string, string>>

/** Declare a rule's messages. Identity, so the keys keep their literal types. */
export const messages = <const M extends Messages>(registry: M): M => registry

/**
 * A place in a file, by character offset.
 *
 * A call site, an object literal and a column all know their offset but not their
 * file -- they are recorded within one -- so the two travel together here.
 */
export interface Span {
  readonly file: string
  readonly start: number
  /** Left out means the column is computed from the offset. */
  readonly column?: number | undefined
}

/**
 * What a finding is about. The engine resolves it to a `SourceLocation`, so a
 * rule names the thing rather than doing the arithmetic.
 *
 * Reporting by subject is not a convenience: hand-computed locations are how
 * `object-shape` shipped every finding at line 1.
 */
export type Subject = Unit | SourceFile | SourceLocation | Span

/** Turn a subject into the location the report needs. */
export type Locate = (subject: Subject) => SourceLocation

const isUnit = (subject: Subject): subject is Unit => "location" in subject
const isFile = (subject: Subject): subject is SourceFile => "path" in subject
const isLocation = (subject: Subject): subject is SourceLocation => "line" in subject

/**
 * A locator for one workspace.
 *
 * It caches each file's line starts, so many findings in one file do not each
 * re-scan it, and a span's column is derived from where its line begins.
 *
 * @param workspace - the analysed workspace, whose files carry the text.
 * @returns a function from a subject to its location.
 */
export const locator = (workspace: Workspace): Locate => {
  let index: Map<string, SourceFile> | undefined
  const byPath = (): Map<string, SourceFile> => {
    if (index === undefined) {
      index = new Map()
      // A rule is tested against a stub workspace that may not carry files, and a
      // subject already carrying a location never needs them.
      for (const file of workspace.files ?? []) index.set(file.path, file)
    }
    return index
  }
  const starts = new Map<string, ReadonlyArray<number>>()
  return (subject) => {
    if (isUnit(subject)) return subject.location
    if (isFile(subject)) return { file: subject.path, line: 1, column: 1 }
    if (isLocation(subject)) {
      return { file: subject.file, line: subject.line, column: subject.column }
    }
    // Absence is a local fact, not an API: a subject whose file the workspace
    // does not carry still reports, at the file's first line.
    let startsOfFile = starts.get(subject.file)
    if (startsOfFile === undefined) {
      const source = byPath().get(subject.file)
      if (source === undefined) {
        return { file: subject.file, line: 1, column: subject.column ?? 1 }
      }
      startsOfFile = lineStarts(source.text)
      starts.set(subject.file, startsOfFile)
    }
    const line = lineAt(startsOfFile, subject.start)
    const column = subject.column ?? subject.start - (startsOfFile[line - 1] ?? 0) + 1
    return { file: subject.file, line, column }
  }
}

/** What to report, in terms of a subject and a message id. */
export interface ReportInput {
  readonly about: Subject
  readonly messageId: string
  /** Fills the `{{name}}` holes in the message template. */
  readonly data?: Readonly<Record<string, string | number>> | undefined
  /** A second registry entry, for the help text. Shares `data`. */
  readonly helpId?: string | undefined
  /** Overrides the rule's move, for a rule that proposes more than one. */
  readonly move?: Move | undefined
  /** Overrides the rule's own `judged`, for an unverified finding. */
  readonly judged?: boolean | undefined
  readonly severity?: Severity | undefined
  readonly confidence?: number | undefined
  readonly score?: number | undefined
  readonly identity?: string | undefined
  readonly repair?: Repair | undefined
}

export type Report = (input: ReportInput) => Diagnostic

/** The rule fields a reporter needs. Both rule kinds have them. */
export interface ReportedRule {
  readonly id: string
  readonly severity: Severity
  readonly judged: boolean
  readonly messages?: Messages | undefined
  readonly move?: Move | undefined
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g

/**
 * Fill a message template, and say so when it cannot be filled.
 *
 * A missing id or a missing datum is a bug in the rule, not a condition of the
 * code under analysis, so it throws rather than reporting a partial sentence.
 * Tests catch it where it belongs.
 */
const fill = (input: {
  readonly template: string
  readonly data: Readonly<Record<string, string | number>> | undefined
  readonly ruleId: string
  readonly messageId: string
}): string =>
  input.template.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = input.data?.[name]
    if (value === undefined) {
      throw RuleAuthoringError.make({
        ruleId: input.ruleId,
        messageId: input.messageId,
        detail: "the template needs data." + name,
      })
    }
    return String(value)
  })

/** Resolve a registry entry, or throw the authoring error that names the rule. */
const templateFor = (input: {
  readonly rule: ReportedRule
  readonly messageId: string
  readonly data: Readonly<Record<string, string | number>> | undefined
}): string => {
  const template = input.rule.messages?.[input.messageId]
  if (template === undefined) {
    throw RuleAuthoringError.make({
      ruleId: input.rule.id,
      messageId: input.messageId,
      detail: "no message is declared with this id",
    })
  }
  return fill({
    template,
    data: input.data,
    ruleId: input.rule.id,
    messageId: input.messageId,
  })
}

/**
 * Bind a rule to its messages and a locator, giving the report function a rule
 * calls.
 *
 * @param rule - the rule, whose `messages` registry is the only place a message
 *   string may live.
 * @param locate - how a subject becomes a location, from {@link locator}.
 * @returns the report function.
 */
export const reporter = (rule: ReportedRule, locate: Locate): Report => (input) => {
  const message = templateFor({ rule, messageId: input.messageId, data: input.data })
  const help =
    input.helpId === undefined
      ? undefined
      : templateFor({ rule, messageId: input.helpId, data: input.data })
  return finding({
    ruleId: rule.id,
    severity: input.severity ?? rule.severity,
    message,
    help,
    location: locate(input.about),
    judged: input.judged ?? rule.judged,
    confidence: input.confidence,
    score: input.score,
    identity: input.identity,
    repair: input.repair,
    move: input.move ?? rule.move,
  })
}
