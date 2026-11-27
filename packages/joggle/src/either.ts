import { Data } from "effect"

/*
 * The refusal this package kept inventing.
 *
 * A lookup's absence is `Option`: the value was not there and the caller only
 * needs to know that. This module used to carry a second helper, `lookup`, that
 * returned `Result<A, NoMatch>` so the miss could name what it looked for. Both
 * call sites immediately discarded the failure -- plans.ts with `getOrElse`, the
 * remedy audit with `getOrUndefined` -- so the reason was never read and the
 * wrapper only moved the absence one layer away from the primitive that already
 * spells it. Option is the primitive; it does not need a reason attached.
 *
 * A refusal that must name its subject is different, and is BuildFailure. The
 * finding that paid for this module is plumb's `no-builtin-throws`: remedies.ts
 * threw `new Error` when a repair label could not be composed.
 */

/**
 * A build failure that must carry its subject.
 *
 * A tagged error, never `new Error`: the family is the refusal a caller matches
 * on, the subject is the exact input the build refused, and the message is the
 * prose a terminal prints. `Effect.catchTag("joggle/BuildFailure", …)` can tell
 * this apart from a provider failure without parsing a stack trace.
 *
 * Thrown only where the build cannot continue; a recoverable absence is
 * `Option.none()`, not a failure.
 */
export class BuildFailure extends Data.TaggedError("joggle/BuildFailure")<{
  readonly family: string
  readonly subject: string
  readonly message: string
}> {}
