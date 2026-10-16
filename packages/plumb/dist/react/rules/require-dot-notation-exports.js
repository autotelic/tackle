import { defineRule } from "@oxlint/plugins";
import { isString } from "../../shared/structural.js";
import { hookFamily, isProviderName } from "../role.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/**
 * Whether a component family (a Provider plus a useXxx hook sharing one family
 * name) must carry a dot-notation aggregate export. The useXxx hook is the
 * family's consumption API and is exported separately by convention, so
 * `aggregateOk` only asks whether the aggregate (export const Family = {
 * Provider, ... }) exists and carries its Provider.
 *
 * @param {{ providerFamily: string | null; hookFamily: string; singleFamily: boolean; aggregateOk: boolean }} input - The family's export facts.
 * @returns {boolean} True when an aggregate is required but absent.
 */
export function familyRequiresAggregate(input) {
    const providerPresent = input.providerFamily === input.hookFamily ||
        (input.providerFamily === "" && input.singleFamily);
    return providerPresent && !input.aggregateOk;
}
/**
 * Property key names of an object literal.
 *
 * @param {ESTree.Node} node - The object expression node.
 * @returns {Set<string>} The property key names.
 */
function objectPropKeys(node) {
    const keys = new Set();
    if (node.type !== "ObjectExpression")
        return keys;
    for (const prop of node.properties) {
        if (prop.type === "Property") {
            const key = prop.key;
            if (key.type === "Identifier")
                keys.add(key.name);
            else if (key.type === "Literal" && isString(key.value))
                keys.add(key.value);
        }
    }
    return keys;
}
/**
 * Whether an aggregate's keys include the Provider (the family's stateful root).
 * The useXxx hook is the family's consumption API and is exported separately by
 * convention, so it need not appear as a key of the aggregate.
 *
 * @param {Set<string>} keys - The aggregate object's property keys.
 * @returns {boolean} True when both the Provider and the hook are present.
 */
function hasProviderKey(keys) {
    for (const k of keys)
        if (k === "Provider" || /Provider$/u.test(k))
            return true;
    return false;
}
/**
 * A component family (a Provider plus a `useXxx` consumer hook) must be exported
 * through a single dot-notation aggregate (`export const Family = { Provider, ... }`)
 * so consumers compose `Family.Provider` / `Family.Header` and the blocks are
 * discoverable. Bare re-exports of `Provider`/`useXxx` without the aggregate
 * hide the family boundary.
 *
 * Uses createOnce; per-file state is reset in before() (which oxlint calls per
 * file), so a family seen in one file cannot leak into another.
 */
export const requireDotNotationExportsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require a component family (Provider + useXxx hook) to be exported via a single dot-notation aggregate (export const Family = { Provider, ... }).",
        },
        messages: {
            missingAggregate: "Component family `{{family}}` exports a Provider and a `use{{family}}` hook but no dot-notation aggregate `export const {{family}} = { Provider, ... }`. Export the family as one object so consumers compose `{{family}}.Provider` / `{{family}}.Header` and the blocks are discoverable.",
        },
    },
    createOnce(context) {
        const providerBases = new Set();
        const hookFamilies = new Set();
        const aggregates = new Map();
        let reportNode = null;
        const recordName = (entry) => {
            if (reportNode === null)
                reportNode = entry.node;
            if (isProviderName(entry.name)) {
                providerBases.add(entry.name === "Provider" ? "" : entry.name.slice(0, -"Provider".length));
            }
            const hf = hookFamily(entry.name);
            if (hf !== null)
                hookFamilies.add(hf);
        };
        return {
            before() {
                providerBases.clear();
                hookFamilies.clear();
                aggregates.clear();
                reportNode = null;
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ExportNamedDeclaration(node) {
                const decl = node.declaration;
                if (decl !== null && decl !== undefined) {
                    if (decl.type === "VariableDeclaration") {
                        for (const declarator of decl.declarations) {
                            if (declarator.id.type !== "Identifier")
                                continue;
                            recordName({ name: declarator.id.name, node });
                            if (declarator.init?.type === "ObjectExpression") {
                                aggregates.set(declarator.id.name, objectPropKeys(declarator.init));
                            }
                        }
                    }
                    else if (decl.type === "FunctionDeclaration" && decl.id !== null) {
                        recordName({ name: decl.id.name, node });
                    }
                }
                for (const specifier of node.specifiers) {
                    if (specifier.type !== "ExportSpecifier")
                        continue;
                    const exported = specifier.exported;
                    const name = exported.type === "Identifier" ? exported.name : (exported.value ?? "");
                    recordName({ name, node });
                }
            },
            "Program:exit"() {
                if (hookFamilies.size === 0)
                    return;
                const node = reportNode;
                if (node === null)
                    return;
                const singleFamily = hookFamilies.size === 1;
                for (const family of hookFamilies) {
                    const providerPresent = providerBases.has(family) || (providerBases.has("") && singleFamily);
                    if (!providerPresent)
                        continue;
                    const agg = aggregates.get(family);
                    const ok = agg !== undefined && hasProviderKey(agg);
                    if (ok)
                        continue;
                    context.report({ node, messageId: "missingAggregate", data: { family } });
                }
            },
        };
    },
});
