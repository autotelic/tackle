import { Data, Result } from "effect"

/*
 * The two answers this package kept inventing.
 *
 * Absence is a value with a reason: a sync lookup returns
 * `Result<A, NoMatch>` so the miss names what was looked for, and an operation
 * that can fail returns Effect with a tagged failure. Do not introduce Option
 * here -- the package already decided that an Option cannot carry the reason a
 * caller has to branch on.
 *
 * A refusal that must name its family and subject is BuildFailure. The findings
 * that paid for this module are plumb's `guarded-op-must-return-option`
 * (remedies.ts's `familyOfRule` returned `string | undefined`) and
 * `no-builtin-throws` (remedies.ts's `composeRemedy` threw `new Error`).
 */

/**
 * The absence a lookup reports: the value was not there, and this is the thing
 * that was looked for.
 *
 * A tagged error rather than `undefined`, so a caller that only needs "is it
 * there" still reads `Result.isFailure`, and a caller that reports the miss can
 * name it without reconstructing the context.
 */
export class NoMatch extends Data.TaggedError("joggle/NoMatch")<{
  readonly lookedFor: string
}> {}

/**
 * A lookup that may find nothing, with the miss carrying what was looked for.
 *
 * The ordinary absence: a Map miss, a search that found no member, an
 * annotation that was never attached. A lookup that must say WHY it found
 * nothing is a different Result, with the reason as its failure -- see store.ts's
 * `StoreError` and calibration.ts's `Majority` -- because "nothing" alone is not
 * a branch a caller can take.
 *
 * @param find - the lookup, evaluated once; `null` and `undefined` both mean
 * absent.
 * @param lookedFor - what the miss should name when the lookup finds nothing.
 * @returns the value, or a `NoMatch` naming the thing that was absent.
 */
export const lookup = <A>(
  find: () => A | null | undefined,
  lookedFor: string,
): Result.Result<NonNullable<A>, NoMatch> =>
  Result.fromNullishOr(find(), () => new NoMatch({ lookedFor }))

/**
 * A build failure that must carry its subject.
 *
 * A tagged error, never `new Error`: the family is the refusal a caller matches
 * on, the subject is the exact input the build refused, and the message is the
 * prose a terminal prints. `Effect.catchTag("joggle/BuildFailure", …)` can tell
 * this apart from a provider failure without parsing a stack trace.
 *
 * Thrown only where the build cannot continue. A recoverable absence is
 * {@link lookup}, not a failure.
 */
export class BuildFailure extends Data.TaggedError("joggle/BuildFailure")<{
  readonly family: string
  readonly subject: string
  readonly message: string
}> {}
