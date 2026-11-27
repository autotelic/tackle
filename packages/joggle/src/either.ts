import { Data } from "effect"

/*
 * A refusal that must name its subject, and nothing else.
 *
 * A lookup's absence is `Option`: the value was not there and the caller only
 * needs to know that. A build that cannot continue is different, and its reason
 * has to fit in one primitive.
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
