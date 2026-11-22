/**
 * Whether a filename is one the application named as its runtime seam.
 *
 * A seam matches as the whole path or a suffix on a segment boundary, so a config writes
 * `src/cli.ts` and an absolute path ends with `/src/cli.ts`. An empty seam matches nothing:
 * an unset option must not exempt the tree.
 *
 * @param {object} input - The file being linted and the configured seams.
 * @param {string} input.filename - The file path, with forward slashes.
 * @param {ReadonlyArray<string>} input.seams - The configured seam paths.
 * @returns {boolean} True when the file owns the runtime.
 */
export declare const isSeamFile: (input: {
    readonly filename: string;
    readonly seams: ReadonlyArray<string>;
}) => boolean;
/**
 * Why: an Effect is a description, and `runPromise` is the one place a description becomes
 * a running process with a rejection, a lifetime and a console. Every extra call site is a
 * second entry point with its own failure policy and its own test seam; a handler that runs
 * its own effect cannot be exercised without a second runtime.
 *
 * Which defect it catches: a permissions workstream ran handler effects with
 * `Effect.runPromise` in the route module, so three failure policies lived in one file and
 * the user had to ask for the seam twice. The rule is on unless the application names its
 * entry point, because the default for a service module is "this is not the seam".
 *
 * Narrowing: `seams` lists the files that own the entry point, matched as a path or a
 * segment-boundary suffix. A second legitimate entry point is added there with a reason,
 * not exempted by a suppressed finding. The visitors follow imported bindings, so
 * `import * as E from "effect"` and `import { runPromise as go } from "effect/Effect"` are
 * the same finding as the `Effect.runPromise` call — an alias is a rename, not a seam.
 *
 * The bindings reset in `before` because `createOnce` spans the run: an import in one file
 * must not make the next file's local helper look like the Effect namespace.
 */
export declare const noRunPromiseOutsideSeamRule: import("@oxlint/plugins").Rule;
