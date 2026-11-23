import { defineRule } from "@oxlint/plugins";
import { isString } from "../../shared/structural.js";
import { firstOptionRecord } from "../../shared/rule-options.js";
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$|\/test\//u;
/** The modules that export the Effect namespace itself, not a managed runtime. */
const EFFECT_MODULE = /^effect(?:\/Effect)?$/u;
const RUN_PROMISE = "runPromise";
/** The namespace name code writes without importing it in a snippet; an import adds more. */
const DEFAULT_NAMESPACE = "Effect";
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
export const isSeamFile = (input) => input.seams.some((seam) => {
    const normal = seam.replaceAll("\\", "/").replace(/^\.\//u, "");
    return (normal !== "" && (input.filename === normal || input.filename.endsWith("/" + normal)));
});
const seamsOf = (options) => {
    const seam = firstOptionRecord(options).seams;
    return Array.isArray(seam) ? seam.filter(isString) : [];
};
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
export const noRunPromiseOutsideSeamRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow `Effect.runPromise` outside the configured seam files; an application has one place where a description becomes a running process.",
        },
        messages: {
            outsideSeam: "`Effect.runPromise` starts a runtime outside the seam. Move the entry point to the file that owns the runtime, or name this file in the rule's `seams` option with the reason it is a second one.",
        },
        schema: [
            {
                type: "object",
                properties: { seams: { type: "array", items: { type: "string" } } },
                additionalProperties: false,
            },
        ],
        defaultOptions: [{ seams: [] }],
    },
    createOnce(context) {
        let namespaces = new Set([DEFAULT_NAMESPACE]);
        let direct = new Set();
        let inSeam = false;
        return {
            before() {
                const filename = context.filename.replaceAll("\\", "/");
                namespaces = new Set([DEFAULT_NAMESPACE]);
                direct = new Set();
                if (TEST_FILE.test(filename))
                    return false;
                inSeam = isSeamFile({ filename, seams: seamsOf(context.options) });
            },
            Program(node) {
                for (const statement of node.body) {
                    if (statement.type !== "ImportDeclaration")
                        continue;
                    const source = statement.source.value;
                    if (!EFFECT_MODULE.test(source))
                        continue;
                    for (const specifier of statement.specifiers) {
                        if (specifier.type === "ImportNamespaceSpecifier") {
                            namespaces.add(specifier.local.name);
                            continue;
                        }
                        if (specifier.type !== "ImportSpecifier")
                            continue;
                        const imported = specifier.imported.type === "Identifier"
                            ? specifier.imported.name
                            : specifier.imported.value;
                        if (imported === RUN_PROMISE)
                            direct.add(specifier.local.name);
                    }
                }
            },
            MemberExpression(node) {
                if (inSeam || node.computed)
                    return;
                if (node.object.type !== "Identifier" || !namespaces.has(node.object.name))
                    return;
                if (node.property.type !== "Identifier" || node.property.name !== RUN_PROMISE)
                    return;
                context.report({ node, messageId: "outsideSeam" });
            },
            CallExpression(node) {
                if (inSeam || node.callee.type !== "Identifier")
                    return;
                if (!direct.has(node.callee.name))
                    return;
                context.report({ node: node.callee, messageId: "outsideSeam" });
            },
        };
    },
});
