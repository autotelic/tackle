import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.js";
import { isString } from "../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
const MESSAGE_BY_KIND = {
    "effect-function": "singleUseEffectFunction",
    "effect-program": "singleUseEffectProgram",
    function: "singleUseFunction",
    type: "singleUseType",
};
function isPascalCase(name) {
    return /^[A-Z]/u.test(name);
}
/** Computed or plain property name on a member expression.
 *
 * @param {ESTree.Node} member - The member expression node.
 * @returns {string | null} The property name, or null when unavailable.
 */
function memberName(member) {
    if (member.type !== "MemberExpression")
        return null;
    if (!member.computed) {
        return member.property.type === "Identifier" ? member.property.name : null;
    }
    if (member.property.type === "Literal" && isString(member.property.value)) {
        return member.property.value;
    }
    return null;
}
/** Whether the call resolves to Effect.<method> (one invocation wrapper allowed for Effect.fn("N")(...)).
 *
 * @param {{ call: ESTree.Node; method: string }} payload - The candidate call and Effect method name.
 * @returns {boolean} True when the call targets Effect.<method>.
 */
function isEffectMethodCall(payload) {
    let callee = payload.call;
    if (callee.type === "CallExpression")
        callee = callee.callee;
    if (callee.type !== "MemberExpression")
        return false;
    if (callee.object.type !== "Identifier")
        return false;
    return callee.object.name === "Effect" && memberName(callee) === payload.method;
}
/**
 * Classify an initializer expression by the kind of private candidate it
 * declares: plain function values, Effect.fn-style services, or Effect.gen
 * programs.
 *
 * @param {ESTree.Node} init - The initializer expression of a top-level declarator.
 * @returns {CandidateKind | null} The candidate kind, or null when not a candidate.
 */
function effectInitializerKind(init) {
    const kind = init.type;
    if (kind === "ArrowFunctionExpression" || kind === "FunctionExpression") {
        return "function";
    }
    if (kind !== "CallExpression")
        return null;
    if (isEffectMethodCall({ call: init, method: "fn" }) ||
        isEffectMethodCall({ call: init, method: "fnUntraced" })) {
        return "effect-function";
    }
    if (isEffectMethodCall({ call: init, method: "gen" }))
        return "effect-program";
    return null;
}
function addDeclaredName(declaration, names) {
    if (declaration === null)
        return;
    if (declaration.type === "FunctionDeclaration" ||
        declaration.type === "TSTypeAliasDeclaration" ||
        declaration.type === "TSInterfaceDeclaration") {
        if (declaration.id != null)
            names.add(declaration.id.name);
        return;
    }
    if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
            if (declarator.id.type === "Identifier")
                names.add(declarator.id.name);
        }
    }
}
/** Re-exported or default-exported names are public regardless of local privacy.
 *
 * @param {ESTree.Program} program - Root AST node of the file under lint.
 * @returns {Set<string>} Names treated as public exports.
 */
function exportedNames(program) {
    const names = new Set();
    for (const statement of program.body) {
        if (statement.type === "ExportDefaultDeclaration") {
            addDeclaredName(statement.declaration ?? null, names);
        }
        if (statement.type === "ExportNamedDeclaration") {
            addDeclaredName(statement.declaration ?? null, names);
            if (statement.source === null || statement.source === undefined) {
                for (const specifier of statement.specifiers) {
                    if (specifier.local !== undefined && specifier.local.type === "Identifier") {
                        names.add(specifier.local.name);
                    }
                }
            }
        }
        if (statement.type === "TSExportAssignment") {
            if (statement.expression.type === "Identifier") {
                names.add(statement.expression.name);
            }
        }
    }
    return names;
}
/** Reads inside type positions (: T, as T, generics) are not runtime reads.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} identifier - The identifier reference being counted.
 * @returns {boolean} True when the read sits in a type position.
 */
function hasTypeAncestor(sourceCode, identifier) {
    for (const current of ancestorsOf(sourceCode, identifier)) {
        const kind = current.type;
        if (kind.startsWith("TS"))
            return true;
        if (kind === "Program" ||
            kind === "BlockStatement" ||
            kind === "ExpressionStatement") {
            return false;
        }
    }
    return false;
}
/** Reads inside re-export positions do not count toward private usage.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} identifier - The identifier reference being counted.
 * @returns {boolean} True when the read sits in an export position.
 */
function hasExportAncestor(sourceCode, identifier) {
    for (const current of ancestorsOf(sourceCode, identifier)) {
        const kind = current.type;
        if (kind === "ExportDefaultDeclaration" ||
            kind === "ExportSpecifier" ||
            kind === "TSExportAssignment") {
            return true;
        }
        if (kind === "Program" || kind === "BlockStatement")
            return false;
    }
    return false;
}
/**
 * Runtime reads of a private top-level binding: reads outside type positions
 * and re-export positions.
 *
 * @param {{ sourceCode: SourceCode; variable: DeclaredVariable }} payload - The declared variable to count.
 * @returns {number} Number of qualifying reads.
 */
function runtimeReadCount(payload) {
    return payload.variable.references.filter((reference) => reference.isRead() &&
        !hasTypeAncestor(payload.sourceCode, reference.identifier) &&
        !hasExportAncestor(payload.sourceCode, reference.identifier)).length;
}
/**
 * Type-position reads of a private top-level type alias or interface.
 *
 * @param {{ sourceCode: SourceCode; variable: DeclaredVariable }} payload - The declared type to count.
 * @returns {number} Number of qualifying reads.
 */
function typeReadCount(payload) {
    return payload.variable.references.filter((reference) => reference.isRead() &&
        hasTypeAncestor(payload.sourceCode, reference.identifier) &&
        !hasExportAncestor(payload.sourceCode, reference.identifier)).length;
}
/**
 * Usage count for a candidate, using the read model appropriate to its kind.
 *
 * @param {{ sourceCode: SourceCode; candidate: Candidate }} payload - The candidate to count.
 * @returns {number} The usage count.
 */
function useCount(payload) {
    return payload.candidate.kind === "type"
        ? typeReadCount({ sourceCode: payload.sourceCode, variable: payload.candidate.variable })
        : runtimeReadCount({ sourceCode: payload.sourceCode, variable: payload.candidate.variable });
}
/**
 * The declared-variable record matching a name among a node's declarations.
 *
 * @param {{ sourceCode: SourceCode; node: ESTree.Node; name: string }} payload - Lookup inputs.
 * @returns {DeclaredVariable | undefined} The matching record, if any.
 *   For a VariableDeclarator the binding lives on its parent VariableDeclaration, so the declarator is unwrapped first.
 */
function declaredVariablesOf(payload) {
    const node = payload.node.type === "VariableDeclarator"
        ? (ancestorsOf(payload.sourceCode, payload.node).find((ancestor) => ancestor.type === "VariableDeclaration") ?? payload.node)
        : payload.node;
    return payload.sourceCode.getDeclaredVariables(node).find((variable) => variable.name === payload.name);
}
/** Extract the handler function nested inside an Effect initializer (Effect.fn / Effect.gen).
 *
 * @param {ESTree.Node | null | undefined} init - The candidate's initializer expression.
 * @returns {ESTree.Node | null} The handler function node, or null when absent.
 */
function effectHandler(init) {
    if (init === null || init === undefined || init.type !== "CallExpression")
        return null;
    let handler = null;
    for (const arg of init.arguments) {
        if (arg.type === "FunctionExpression" ||
            arg.type === "ArrowFunctionExpression" ||
            arg.type === "FunctionDeclaration") {
            handler = arg;
        }
    }
    return handler;
}
/** Simple identifier parameter names, or null when any parameter is a pattern.
 *
 * @param {ESTree.Node} fn - The function-like node to inspect.
 * @returns {Set<string> | null} The parameter names, or null for non-functions/patterns.
 */
function paramNames(fn) {
    if (fn.type !== "FunctionDeclaration" &&
        fn.type !== "FunctionExpression" &&
        fn.type !== "ArrowFunctionExpression") {
        return null;
    }
    const names = new Set();
    for (const param of fn.params) {
        if (param.type !== "Identifier")
            return null;
        names.add(param.name);
    }
    return names;
}
/**
 * Whether a function is a pure alias: it returns a single call that forwards
 * each of its parameters verbatim (a generator may delegate-yield such a call).
 * Anything else raises the level of abstraction and earns its name.
 *
 * @param {ESTree.Node} fn - The function-like node to inspect.
 * @returns {boolean} True when the function is dead indirection.
 */
export function isTrivialForwarder(fn) {
    if (fn.type !== "FunctionDeclaration" &&
        fn.type !== "FunctionExpression" &&
        fn.type !== "ArrowFunctionExpression") {
        return false;
    }
    const names = paramNames(fn);
    if (names === null || names.size === 0)
        return false;
    let call = null;
    if (fn.body !== null && fn.body.type === "BlockStatement") {
        const statements = fn.body.body;
        const statement = statements[0];
        if (statement !== undefined && statement.type === "ReturnStatement") {
            const argument = statement.argument;
            if (argument !== null && argument !== undefined && argument.type === "CallExpression") {
                call = argument;
            }
            else if (argument !== null &&
                argument !== undefined &&
                argument.type === "YieldExpression" &&
                argument.delegate === true &&
                argument.argument !== null &&
                argument.argument !== undefined &&
                argument.argument.type === "CallExpression") {
                call = argument.argument;
            }
        }
    }
    else if (fn.type === "ArrowFunctionExpression" && fn.body !== null && fn.body.type === "CallExpression") {
        call = fn.body;
    }
    if (call === null)
        return false;
    const seen = new Set();
    for (const arg of call.arguments) {
        if (arg.type !== "Identifier")
            return false;
        if (!names.has(arg.name) || seen.has(arg.name))
            return false;
        seen.add(arg.name);
    }
    return seen.size === names.size;
}
/**
 * Whether a single-use candidate is dead indirection worth inlining: a pure
 * alias that forwards its inputs verbatim. Substantial single-use helpers that
 * raise the level of abstraction are kept (the document's "factor at n=1").
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {Candidate} candidate - The candidate to grade.
 * @returns {boolean} True when the candidate is a pure alias.
 */
function isDeadIndirection(sourceCode, candidate) {
    if (candidate.kind === "type")
        return false;
    let fn = null;
    if (candidate.kind === "function") {
        const node = candidate.node;
        if (node.type === "FunctionDeclaration") {
            fn = node;
        }
        else if (node.type === "VariableDeclarator") {
            fn = node.init ?? null;
        }
    }
    else {
        const node = candidate.node;
        fn = node.type === "VariableDeclarator" ? effectHandler(node.init) : null;
    }
    if (fn === null)
        return false;
    return isTrivialForwarder(fn);
}
/**
 * Top-level privates referenced exactly once are only worth inlining when they
 * are pure aliases (they forward their inputs verbatim to another call). A
 * single-use helper that earns its name by raising the level of abstraction is
 * kept: the document argues for factoring proactively, even at n=1.
 */
export const noSingleUsePrivateFunctionsRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Inline private top-level functions and Effect values that are referenced exactly once as a pure alias (they forward their inputs verbatim to another call); single-use indirection that adds no abstraction hides shape. Single-use helpers that raise the level of abstraction earn their name and are kept.",
        },
        messages: {
            singleUseFunction: "Private function {{name}} is a single-use pure alias: it forwards its inputs verbatim to another call. Inline the forwarded call at its use site instead of naming zero-abstraction indirection.",
            singleUseEffectFunction: "Private Effect function {{name}} is run exactly once as a pure alias. Inline the forwarded handler at its single use site instead of naming zero-abstraction indirection.",
            singleUseEffectProgram: "Private Effect program {{name}} is composed into exactly one pipeline as a pure alias. Inline it there instead of naming zero-abstraction indirection.",
            singleUseType: "Private type {{name}} is referenced exactly once. Inline the annotation at that use site instead of naming it.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            Program(node) {
                const sourceCode = context.sourceCode;
                const exported = exportedNames(node);
                const documented = new Set();
                for (const statement of node.body) {
                    const comments = context.sourceCode.getCommentsBefore(statement);
                    const last = comments[comments.length - 1];
                    if (last !== undefined && last.type === "Block" && last.value.startsWith("*")) {
                        documented.add(statement);
                    }
                }
                const candidates = [];
                for (const statement of node.body) {
                    if (documented.has(statement))
                        continue;
                    if (statement.type === "FunctionDeclaration") {
                        const name = statement.id?.name;
                        if (name === undefined || exported.has(name) || isPascalCase(name))
                            continue;
                        const variable = declaredVariablesOf({ sourceCode, node: statement, name });
                        if (variable !== undefined) {
                            candidates.push({ kind: "function", name, node: statement, variable });
                        }
                        continue;
                    }
                    if (statement.type === "TSTypeAliasDeclaration" || statement.type === "TSInterfaceDeclaration") {
                        const name = statement.id.name;
                        if (exported.has(name))
                            continue;
                        const variable = declaredVariablesOf({ sourceCode, node: statement, name });
                        if (variable !== undefined) {
                            candidates.push({ kind: "type", name, node: statement, variable });
                        }
                        continue;
                    }
                    if (statement.type !== "VariableDeclaration")
                        continue;
                    for (const declarator of statement.declarations) {
                        if (declarator.id.type !== "Identifier")
                            continue;
                        const { name } = declarator.id;
                        const init = declarator.init;
                        if (init === null || init === undefined)
                            continue;
                        const candidateKind = effectInitializerKind(init);
                        if (candidateKind === null)
                            continue;
                        const chain = ancestorsOf(sourceCode, declarator);
                        const parentIndex = chain.findIndex((ancestor) => ancestor.type === "VariableDeclaration");
                        const parent = parentIndex >= 0 ? chain[parentIndex] : undefined;
                        const grandparent = parentIndex > 0 ? chain[parentIndex - 1] : chain[parentIndex + 1];
                        if (parent === undefined || grandparent === undefined || grandparent.type !== "Program") {
                            continue;
                        }
                        if (exported.has(name) || isPascalCase(name))
                            continue;
                        const variable = declaredVariablesOf({ sourceCode, node: declarator, name });
                        if (variable !== undefined) {
                            candidates.push({ kind: candidateKind, name, node: declarator, variable });
                        }
                    }
                }
                for (const candidate of candidates) {
                    if (useCount({ sourceCode, candidate }) !== 1)
                        continue;
                    if (!isDeadIndirection(sourceCode, candidate))
                        continue;
                    context.report({
                        node: candidate.node,
                        messageId: MESSAGE_BY_KIND[candidate.kind],
                        data: { name: candidate.name },
                    });
                }
            },
        };
    },
});
