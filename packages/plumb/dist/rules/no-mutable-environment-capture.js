import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/**
 * Whether the identifier sits inside a type annotation rather than a value position.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} identifier - The reference identifier to test.
 * @returns {boolean} True when an ancestor is a TypeScript type node.
 */
function isTypePosition(sourceCode, identifier) {
    for (const ancestor of ancestorsOf(sourceCode, identifier)) {
        if (ancestor.type.startsWith("TS"))
            return true;
    }
    return false;
}
/**
 * The name a function is called by at its definition site.
 *
 * @param {ESTree.Node} node - The function-like node.
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @returns {string} The function's name, or "(anonymous)".
 */
function functionName(node, sourceCode) {
    if (node.type === "FunctionDeclaration" && node.id !== null)
        return node.id.name;
    const parent = ancestorsOf(sourceCode, node)[0];
    if (parent !== undefined) {
        if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
            return parent.id.name;
        if (parent.type === "AssignmentExpression" && parent.left.type === "Identifier")
            return parent.left.name;
        if (parent.type === "MethodDefinition" && parent.key.type === "Identifier")
            return parent.key.name;
        if (parent.type === "Property" && parent.key.type === "Identifier")
            return parent.key.name;
        if (parent.type === "ExportDefaultDeclaration")
            return "default";
    }
    return "(anonymous)";
}
/**
 * Collect module-scope let/var bindings, separating real state from
 * function-valued helpers (which are legitimate module-private utilities).
 *
 * @param {ESTree.Program} program - The file's root node.
 * @returns {ModuleState} Mutable state names and helper names.
 */
function collectModuleState(program) {
    const state = new Set();
    const helpers = new Set();
    for (const statement of program.body) {
        const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
        if (declaration === null || declaration === undefined)
            continue;
        if (declaration.type !== "VariableDeclaration")
            continue;
        if (declaration.kind !== "let" && declaration.kind !== "var")
            continue;
        for (const declarator of declaration.declarations) {
            if (declarator.id.type !== "Identifier")
                continue;
            const init = declarator.init;
            const isHelper = init !== null &&
                init !== undefined &&
                (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression");
            (isHelper ? helpers : state).add(declarator.id.name);
        }
    }
    return { state, helpers };
}
/**
 * A function that reads or writes module state instead of taking it as a
 * parameter is dishonest: its result depends on outside context, so it is not
 * locally testable. Inject the value at the call site (the document's seed-the
 * PRNG-once, pass-it-in pattern) so the dependency is explicit in the signature.
 */
export const noMutableEnvironmentCaptureRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow functions that read or write module-scope mutable state (let/var) instead of receiving it as a parameter; hidden module state makes a function dishonest and not locally testable.",
        },
        messages: {
            mutableModuleState: "Function `{{name}}` {{kind}} module-scope mutable state `{{binding}}` rather than receiving it as a parameter. Hidden module state makes the function dishonest: its result depends on outside context, so it is not locally testable. Inject `{{binding}}` at the call site or thread it through the signature so the dependency is explicit.",
        },
    },
    createOnce(context) {
        let moduleState = { state: new Set(), helpers: new Set() };
        const check = (node) => {
            if (node.type !== "FunctionDeclaration" &&
                node.type !== "FunctionExpression" &&
                node.type !== "ArrowFunctionExpression") {
                return;
            }
            const scope = context.sourceCode.getScope(node);
            const { state, helpers } = moduleState;
            for (const reference of scope.references) {
                const resolved = reference.resolved;
                if (resolved === null || resolved === undefined)
                    continue;
                const name = resolved.name;
                if (helpers.has(name))
                    continue;
                if (!state.has(name))
                    continue;
                if (isTypePosition(context.sourceCode, reference.identifier))
                    continue;
                context.report({
                    node: reference.identifier,
                    messageId: "mutableModuleState",
                    data: {
                        name: functionName(node, context.sourceCode),
                        kind: reference.isWrite() ? "writes" : "reads",
                        binding: name,
                    },
                });
            }
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            Program(node) {
                moduleState = collectModuleState(node);
            },
            FunctionDeclaration: check,
            FunctionExpression: check,
            ArrowFunctionExpression: check,
        };
    },
});
