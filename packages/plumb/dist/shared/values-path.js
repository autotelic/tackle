import { firstOptionRecord } from "./rule-options.js";
import { isString } from "./structural.js";
/**
 * The directories a repository declares as its values stratum.
 *
 * The default is a CONVENTION, not a fact: `domain`, `values` and `model` are
 * the names repositories give the folder that holds `Money` and `Hours`. A
 * repository whose values live somewhere else names the path in the rule's
 * options (`{ "paths": ["src/domain"] }`), because a lint rule cannot infer
 * where the pure layer is from one file.
 */
const DEFAULT_SEGMENTS = new Set(["domain", "model", "value-objects", "values"]);
/**
 * The declared path prefixes, or an empty list when the option is absent or malformed.
 *
 * @param {readonly unknown[] | undefined} options - The rule's raw options.
 * @returns {ReadonlyArray<string>} The non-empty path prefixes, if any.
 */
function declaredPaths(options) {
    const record = firstOptionRecord(options);
    const declared = record["paths"];
    if (!Array.isArray(declared))
        return [];
    return declared.filter((entry) => isString(entry) && entry.length > 0);
}
/** Normalise a path prefix so `./src/domain/` and `src/domain` compare equally.
 *
 * @param {string} path - The path or prefix to normalise.
 * @returns {string} A slash-only path with no leading `./` or trailing slash.
 */
function normalise(path) {
    return path.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}
/**
 * Whether a file belongs to the declared values path.
 *
 * A declared prefix matches the file itself or anything below it. With no
 * option, a directory SEGMENT carries the name, so `src/domain/money.ts` and
 * `packages/domain/src/hours.ts` are both values.
 *
 * @param {string} filename - The file being linted.
 * @param {readonly unknown[] | undefined} options - The rule's raw options.
 * @returns {boolean} True when the file is inside the values stratum.
 */
export function inValuesPath(filename, options) {
    const file = normalise(filename);
    const paths = declaredPaths(options);
    if (paths.length > 0) {
        return paths.some((prefix) => {
            const normalised = normalise(prefix);
            return file === normalised || file.startsWith(`${normalised}/`) || file.includes(`/${normalised}/`);
        });
    }
    const directories = file.split("/").slice(0, -1);
    return directories.some((segment) => DEFAULT_SEGMENTS.has(segment));
}
