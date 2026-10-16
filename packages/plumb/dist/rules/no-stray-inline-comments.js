import { defineRule } from "@oxlint/plugins";
import { getAllComments } from "../shared/structural.js";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$/u;
/** Directive and safety comments are tooling contracts, not prose. */
const EXEMPT = /^(?:SAFETY:|eslint|oxlint|@ts-|ts-check|jscpd)/iu;
/** Stray inline notes inside a function body belong in its JSDoc, not the code. */
export const noStrayInlineCommentsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow // line comments inside function bodies: notes about a function's behaviour belong in that function's JSDoc (description or annotated tags), keeping the body purely executable.",
        },
        messages: {
            strayInlineComment: "Stray inline comment inside a function body. Move the note into the enclosing declaration's JSDoc (as description prose or an annotated note) or delete it.",
        },
    },
    createOnce(context) {
        const bodyRanges = [];
        const recordBody = (body) => {
            if (body?.range !== undefined && body.range !== null)
                bodyRanges.push(body.range);
        };
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
                bodyRanges.length = 0;
            },
            FunctionDeclaration(node) {
                recordBody(node.body);
            },
            FunctionExpression(node) {
                recordBody(node.body);
            },
            ArrowFunctionExpression(node) {
                recordBody(node.body);
            },
            "Program:exit"() {
                const lineComments = (getAllComments(context.sourceCode)).filter((comment) => comment.type === "Line");
                const exempt = new Set();
                lineComments.forEach((comment, index) => {
                    if (!EXEMPT.test(comment.value.trim()))
                        return;
                    exempt.add(comment);
                    let previousEnd = comment.loc?.end?.line;
                    let cursor = index + 1;
                    while (previousEnd !== undefined &&
                        cursor < lineComments.length) {
                        const next = lineComments[cursor];
                        const nextStart = next.loc?.start?.line;
                        if (nextStart === undefined || nextStart !== previousEnd + 1)
                            break;
                        exempt.add(next);
                        previousEnd = next.loc?.end?.line;
                        cursor += 1;
                    }
                });
                for (const comment of lineComments) {
                    if (exempt.has(comment))
                        continue;
                    const start = comment.range?.[0];
                    if (start === undefined)
                        continue;
                    if (!bodyRanges.some(([from, to]) => start > from && start < to))
                        continue;
                    context.report({
                        loc: { start: { line: comment.loc?.start?.line ?? 1, column: 0 } },
                        messageId: "strayInlineComment",
                    });
                }
            },
        };
    },
});
