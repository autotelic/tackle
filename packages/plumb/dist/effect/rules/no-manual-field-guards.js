import { defineRule } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
function calleeName(node) {
    const callee = node.callee;
    if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
        return callee.property.name;
    }
    return null;
}
/** Whether this node sits inside a `Schema.makeFilter` predicate, where ad-hoc checks are the point.
 *
 * @param {ESTree.Node} node - The visited node.
 * @param {ReadonlyArray<ESTree.Node>} ancestors - Nearest-first ancestor chain of `node`.
 * @returns {boolean} True when enclosed by a makeFilter call.
 */
function insideMakeFilter(node, ancestors) {
    for (let index = ancestors.length - 1; index >= 0; index--) {
        const current = ancestors[index];
        if (current.type === "Program")
            break;
        if (current.type === "CallExpression" && calleeName(current) === "makeFilter") {
            return true;
        }
    }
    return false;
}
/**
 * Once a module decodes payloads through SchemaParser, per-field validation
 * belongs in Schema refinements (checks/filters) so evidence flows through the
 * schema issue channel instead of hand-rolled ladders beside the decoder.
 */
export const noManualFieldGuardsRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "In modules that decode via SchemaParser, require field validation to live in Schema refinements rather than hand-rolled regex tests and Option-tag guards.",
        },
        messages: {
            regexTest: "Hand-rolled lexical check beside a SchemaParser decode. Move this predicate into a Schema refinement (`.check(Schema.makeFilter(...))`) so failures surface as schema issue evidence.",
            optionGuard: "Hand-rolled Option-tag guard beside a SchemaParser decode. Validate the field with a Schema refinement (or decode into the domain value via `SchemaGetter.transformOrFail`) so the ladder branch disappears.",
        },
    },
    createOnce(context) {
        let hasDecode = false;
        const pending = [];
        const optionVars = new Set();
        const queue = (node, messageId) => {
            if (insideMakeFilter(node, ancestorsOf(context.sourceCode, node)))
                return;
            pending.push({ node, messageId });
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
                hasDecode = false;
                pending.length = 0;
                optionVars.clear();
            },
            CallExpression(node) {
                const name = calleeName(node);
                if (name !== null && name.startsWith("decodeUnknown"))
                    hasDecode = true;
                {
                    const callee = node.callee;
                    if (callee.type === "MemberExpression" &&
                        !callee.computed &&
                        callee.property.type === "Identifier" &&
                        callee.property.name === "test") {
                        queue(node, "regexTest");
                        return;
                    }
                }
                if (name === "isNone" || name === "isSome") {
                    const argument = node.arguments[0];
                    if (argument !== undefined &&
                        argument.type === "Identifier" &&
                        optionVars.has(argument.name)) {
                        queue(node, "optionGuard");
                    }
                }
            },
            IfStatement(node) {
                const binaryTest = node.test;
                if (binaryTest.type !== "BinaryExpression")
                    return;
                if (binaryTest.operator !== "===" && binaryTest.operator !== "!==")
                    return;
                const sides = [binaryTest.left, binaryTest.right];
                const hasTagSide = sides.some((side) => side.type === "MemberExpression" &&
                    side.property.type === "Identifier" &&
                    side.property.name === "_tag");
                const literal = sides.find((side) => side.type === "Literal");
                if (!hasTagSide ||
                    literal === undefined ||
                    literal.type !== "Literal" ||
                    (literal.value !== "None" && literal.value !== "Some"))
                    return;
                const tagMember = sides.find((side) => {
                    return side.type === "MemberExpression" && side.object.type === "Identifier";
                });
                if (tagMember !== undefined &&
                    tagMember.object.type === "Identifier" &&
                    optionVars.has(tagMember.object.name)) {
                    queue(node.test, "optionGuard");
                }
            },
            "Program:exit"() {
                if (!hasDecode)
                    return;
                for (const { node, messageId } of pending) {
                    context.report({ node, messageId });
                }
            },
            VariableDeclarator(node) {
                if (node.init !== null && node.init !== undefined && node.init.type === "CallExpression") {
                    const name = calleeName(node.init);
                    if (name !== null &&
                        name.startsWith("from") &&
                        name.endsWith("Option") &&
                        node.id.type === "Identifier") {
                        optionVars.add(node.id.name);
                    }
                }
            },
        };
    },
});
