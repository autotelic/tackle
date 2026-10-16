import { defineRule } from "@oxlint/plugins";
import { isString } from "../../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** The three required keys of a context value type. */
const REQUIRED_KEYS = ["state", "actions", "meta"];
/**
 * Whether a context value type's member keys form the tripartite
 * state/actions/meta contract.
 *
 * @param {ReadonlyArray<string>} members - The declared member key names.
 * @returns {boolean} True when `state`, `actions`, and `meta` are all present.
 */
export function isTripartiteContextValue(members) {
    const present = new Set(members);
    return REQUIRED_KEYS.every((key) => present.has(key));
}
/**
 * Member key names of a TS object type (interface body or inline literal).
 *
 * @param {ESTree.Node} node - The interface or type-literal node.
 * @returns {ReadonlyArray<string>} The declared member key names.
 */
function memberKeys(node) {
    const keys = [];
    const addKey = (key) => {
        if (key.type === "Identifier")
            keys.push(key.name);
        else if (key.type === "Literal" && isString(key.value))
            keys.push(key.value);
    };
    if (node.type === "TSInterfaceDeclaration") {
        for (const member of node.body.body) {
            if (member.type === "TSPropertySignature" || member.type === "TSMethodSignature")
                addKey(member.key);
        }
    }
    else if (node.type === "TSTypeLiteral") {
        for (const member of node.members) {
            if (member.type === "TSPropertySignature" || member.type === "TSMethodSignature")
                addKey(member.key);
        }
    }
    return keys;
}
/**
 * Final segment of a type reference name.
 *
 * @param {ESTree.TSTypeReference} node - The type reference node.
 * @returns {string | null} The unqualified type name, or null when unavailable.
 */
function typeName(node) {
    const tn = node.typeName;
    if (tn.type === "Identifier")
        return tn.name;
    if (tn.type === "TSQualifiedName")
        return tn.right.name;
    return null;
}
/**
 * Whether the callee references `createContext`.
 *
 * @param {ESTree.Node} callee - The callee expression of a call.
 * @returns {boolean} True when the callee is `createContext`.
 */
function isCreateContext(callee) {
    if (callee.type === "Identifier")
        return callee.name === "createContext";
    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier")
        return callee.property.name === "createContext";
    return false;
}
/**
 * A React context's value must be shaped as `{ state, actions, meta }`: state is
 * the data, actions are the functions that change it, and meta holds
 * non-reactive configuration. This is the explicit I/O boundary of the
 * component family - the same "perfect function" contract as the composition
 * pattern. A context that omits one of the three leaks an implicit, unnamed
 * channel that consumers cannot reason about.
 */
export const requireTripartiteContextRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require React context value types to be the tripartite { state, actions, meta } shape; missing keys leak an implicit, unnamed I/O channel.",
        },
        messages: {
            tripartiteContext: "Context value type is missing required key(s): {{missing}}. A context value must be { state, actions, meta } so its I/O boundary is explicit.",
        },
    },
    createOnce(context) {
        const localTypes = new Map();
        const calls = [];
        /**
         * Resolve a context type argument to declared member keys, if local.
         *
         * @param {ESTree.Node} typeArg - The type argument node passed to createContext.
         * @returns {ReadonlyArray<string> | null} The member keys, or null when unresolved.
         */
        function resolveKeys(typeArg) {
            if (typeArg.type === "TSTypeLiteral")
                return memberKeys(typeArg);
            if (typeArg.type === "TSTypeReference") {
                const name = typeName(typeArg);
                return name === null ? null : localTypes.get(name) ?? null;
            }
            if (typeArg.type === "TSUnionType") {
                for (const member of typeArg.types) {
                    if (member.type === "TSUndefinedKeyword" || member.type === "TSNullKeyword")
                        continue;
                    const resolved = resolveKeys(member);
                    if (resolved !== null)
                        return resolved;
                }
            }
            return null;
        }
        return {
            before() {
                localTypes.clear();
                calls.length = 0;
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            TSInterfaceDeclaration(node) {
                localTypes.set(node.id.name, memberKeys(node));
            },
            TSTypeAliasDeclaration(node) {
                if (node.typeAnnotation.type === "TSTypeLiteral") {
                    localTypes.set(node.id.name, memberKeys(node.typeAnnotation));
                }
            },
            CallExpression(node) {
                if (isCreateContext(node.callee))
                    calls.push(node);
            },
            "Program:exit"() {
                for (const call of calls) {
                    const params = call.typeArguments?.params;
                    if (params === undefined || params.length === 0)
                        continue;
                    const first = params[0];
                    if (first === undefined)
                        continue;
                    const keys = resolveKeys(first);
                    if (keys === null)
                        continue;
                    if (isTripartiteContextValue(keys))
                        continue;
                    const present = new Set(keys);
                    const missing = REQUIRED_KEYS.filter((key) => !present.has(key));
                    context.report({
                        node: call,
                        messageId: "tripartiteContext",
                        data: { missing: missing.join(", ") },
                    });
                }
            },
        };
    },
});
