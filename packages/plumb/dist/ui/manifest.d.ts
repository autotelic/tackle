/** Where a part is in its life. */
export type UiPartStatus = "stable" | "beta" | "experimental" | "deprecated";
/** The subset of a manifest component the deprecation rule reads. */
export interface UiPart {
    readonly path: string;
    readonly name: string;
    readonly exports?: ReadonlyArray<string>;
    readonly status?: UiPartStatus;
    readonly useInstead?: ReadonlyArray<string>;
}
/** A manifest, reduced to the parts and tokens the rules can act on. */
export interface UiManifest {
    readonly components: ReadonlyArray<UiPart>;
    readonly colors: ReadonlyArray<string>;
}
/**
 * Read one component, or `undefined` when it cannot be identified.
 *
 * `tier`, `owners`, `props` and `tags` are required by the manifest schema but not by
 * this rule. Requiring them here would make a hand-written fixture verbose for no gain,
 * and the rule's question is only "who is deprecated, and what replaces it".
 * @param {unknown} value - The decoded JSON entry.
 * @returns {UiPart | undefined} The part, or `undefined` when it cannot be identified.
 */
export declare function decodeUiPart(value: unknown): UiPart | undefined;
/**
 * Read a manifest, or `undefined` when it is not one.
 *
 * @param {unknown} value - The decoded JSON document.
 * @returns {UiManifest | undefined} The manifest, or `undefined` when it is malformed.
 */
export declare function decodeUiManifest(value: unknown): UiManifest | undefined;
/**
 * Read a manifest from disk, degrading to `undefined`.
 *
 * A missing or malformed manifest is not a lint error: the rule goes quiet, exactly as
 * every other manifest reader in this workspace does. `cutlist build --check` is the
 * gate that makes a stale manifest loud.
 *
 * @param {string} path - The manifest file to read.
 * @returns {UiManifest | undefined} The manifest, or `undefined` when it is absent or bad.
 */
export declare function readUiManifest(path: string): UiManifest | undefined;
/**
 * Resolve a configured path against the process working directory.
 *
 * @param {string} path - The manifest path, relative to the process cwd.
 * @returns {UiManifest | undefined} The manifest, or `undefined` when it is absent or bad.
 */
export declare function manifestAt(path: string): UiManifest | undefined;
