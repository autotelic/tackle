import { defineRule } from "@oxlint/plugins";
import { childNodes } from "../../shared/child-nodes.js";
import { readField } from "../../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/**
 * Count Option.none() returns in this function's own body. Nested scopes belong to
 * themselves, and loop bodies hold algorithmic exits rather than guard scatters.
 *
 * @param {ESTree.Node} body - The function body to walk.
 * @returns {number} Number of direct `Option.none()` return exits.
 */
function countDirectNoneReturns(body) {
    let count = 0;
    const visit = (node) => {
        if (node.type === "ArrowFunctionExpression" ||
            node.type === "FunctionExpression" ||
            node.type === "FunctionDeclaration")
            return;
        if (node.type === "ForStatement" ||
            node.type === "ForInStatement" ||
            node.type === "ForOfStatement" ||
            node.type === "WhileStatement" ||
            node.type === "DoWhileStatement") {
            return;
        }
        if (node.type !== "ReturnStatement")
            return void 0;
        const argument = node.argument;
        if (argument?.type === "CallExpression" &&
            argument.callee.type === "MemberExpression" &&
            argument.callee.object.type === "Identifier" &&
            argument.callee.object.name === "Option" &&
            argument.callee.property.type === "Identifier" &&
            argument.callee.property.name === "none")
            count += 1;
        for (const child of childNodes(node))
            visit(child);
    };
    visit(body);
    return count;
}
/** Guard-gauntlets over Option should compose into liftPredicate/filter pipelines. */
export const preferOptionPipelineRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require Option-returning functions to reject through composed pipelines (named Predicates lifted via Option.liftPredicate / narrowed via Option.filter) instead of scattering multiple `return Option.none()` guard exits through the body.",
        },
        messages: {
            preferPipeline: "This Option-returning function rejects through {{count}} scattered `Option.none()` guards. Extract named Predicates and compose them via pipe + Option.liftPredicate / Option.filter so the happy path reads as one pipeline.",
        },
    },
    createOnce(context) {
        const check = (node) => {
            const returnType = node.returnType?.typeAnnotation;
            if (returnType === null || returnType === undefined)
                return;
            if (returnType.type !== "TSTypeReference")
                return;
            const typeName = returnType.typeName;
            const declaresOption = typeName.type === "Identifier"
                ? typeName.name === "Option"
                : typeName.type === "TSQualifiedName" &&
                    typeName.left.type === "Identifier" &&
                    typeName.left.name === "Option" &&
                    typeName.right.type === "Identifier" &&
                    typeName.right.name === "Option";
            if (!declaresOption)
                return;
            if (node.body === null || node.body === undefined)
                return;
            const count = countDirectNoneReturns(node.body);
            if (count < 2)
                return;
            context.report({ node, messageId: "preferPipeline", data: { count: String(count) } });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            ArrowFunctionExpression: check,
            FunctionExpression: check,
            FunctionDeclaration: check,
        };
    },
});
