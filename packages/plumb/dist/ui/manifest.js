import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const STATUSES = ["stable", "beta", "experimental", "deprecated"];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value) {
    return typeof value === "string" ? value : undefined;
}
function strings(value) {
    if (!Array.isArray(value))
        return undefined;
    if (!value.every((entry) => typeof entry === "string"))
        return undefined;
    return value;
}
function status(value) {
    return STATUSES.find((entry) => entry === value);
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
export function decodeUiPart(value) {
    if (!isRecord(value))
        return undefined;
    const path = str(value.path);
    const name = str(value.name);
    if (path === undefined || name === undefined)
        return undefined;
    const exports = strings(value.exports);
    const partStatus = status(value.status);
    const useInstead = strings(value.useInstead);
    return {
        path,
        name,
        ...(exports === undefined ? {} : { exports }),
        ...(partStatus === undefined ? {} : { status: partStatus }),
        ...(useInstead === undefined ? {} : { useInstead }),
    };
}
/**
 * Read a manifest, or `undefined` when it is not one.
 *
 * @param {unknown} value - The decoded JSON document.
 * @returns {UiManifest | undefined} The manifest, or `undefined` when it is malformed.
 */
export function decodeUiManifest(value) {
    if (!isRecord(value) || !Array.isArray(value.components))
        return undefined;
    const components = [];
    for (const entry of value.components) {
        const part = decodeUiPart(entry);
        if (part !== undefined)
            components.push(part);
    }
    return { components };
}
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
export function readUiManifest(path) {
    try {
        return decodeUiManifest(JSON.parse(readFileSync(path, "utf8")));
    }
    catch {
        return undefined;
    }
}
/**
 * Resolve a configured path against the process working directory.
 *
 * @param {string} path - The manifest path, relative to the process cwd.
 * @returns {UiManifest | undefined} The manifest, or `undefined` when it is absent or bad.
 */
export function manifestAt(path) {
    return readUiManifest(resolve(process.cwd(), path));
}
