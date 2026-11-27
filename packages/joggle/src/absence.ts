import { Data, Option } from "effect"

/*
 * The two answers this package kept inventing.
 *
 * A lookup that may find nothing and a build failure that must name what it
 * refused have each been solved more than once here -- Option in store.ts,
 * Result in calibration.ts and hoist-to-domain.ts, an undefined union in
 * remedies.ts. Re-deriving the choice is how one repair grew five shapes.
 *
 * The findings that paid for this module are plumb's
 * `guarded-op-must-return-option` (remedies.ts's `familyOfRule` returned
 * `string | undefined`) and `no-builtin-throws` (remedies.ts's `composeRemedy`
 * threw `new Error`). The next rule author should import one of these two
 * answers before reaching for Option-vs-Either-vs-Result again.
 */

/**
 * A lookup that may find nothing.
 *
 * The ordinary absence: a Map miss, a search that found no member, an
 * annotation that was never attached. The caller composes with Option and moves
 * on. A lookup that must say WHY it found nothing is a Result instead -- see
 * store.ts's `StoreError` and calibration.ts's `Majority` -- because an Option
 * cannot carry the reason a caller has to branch on.
 *
 * @param find - the lookup, evaluated once; `null` and `undefined` both mean
 * absent.
 * @returns the value, or `Option.none()` when the lookup found nothing.
 */
export const lookup = <A>(find: () => A | null | undefined): Option.Option<NonNullable<A>> =>
  Option.fromNullishOr(find())

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
