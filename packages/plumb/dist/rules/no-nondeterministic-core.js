import { defineRule } from "@oxlint/plugins";
const NONDETERMINISTIC_MEMBERS = new Set(["getRandomValues", "random", "randomUUID", "now"]);
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
function memberChain(node) {
    if (node.type === "MemberExpression" && !node.computed) {
        return [...memberChain(node.object), node.property.type === "Identifier" ? node.property.name : ""];
    }
    return [node.type === "Identifier" ? node.name : "?"];
}
/**
 * Canonical form: identical inputs must produce identical outputs. Time and
 * randomness are boundary inputs: capture them once at the edge and pass
 * them in, so cores stay reproducible and their serialisations stable.
 */
export const noNondeterministicCoreRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow nondeterministic sources (Math.random, Date.now, new Date(), crypto randomness) outside tests; inject them as boundary inputs so cores stay canonical.",
        },
        messages: {
            nondeterministicSource: "`{{source}}` makes this code's output depend on when/where it runs, breaking canonical form (identical inputs, identical outputs). Capture it at the boundary and pass it in as a parameter.",
            unseededDate: "`new Date()` captures wall-clock time here, making output non-reproducible. Take the instant as a parameter (or use a fixed epoch for pure conversions).",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            MemberExpression(node) {
                const property = node.property;
                if (node.computed || property.type !== "Identifier" || !NONDETERMINISTIC_MEMBERS.has(property.name)) {
                    return;
                }
                const chain = memberChain(node.object);
                const root = chain[0] ?? "";
                if ((root === "Math" && property.name === "random") || (root === "crypto" && property.name !== "now")) {
                    context.report({
                        node,
                        messageId: "nondeterministicSource",
                        data: { source: `${root}.${property.name}` },
                    });
                    return;
                }
                if (property.name === "now" &&
                    ((root === "Date" && chain.length === 1) || (root === "performance" && chain.length === 1))) {
                    context.report({
                        node,
                        messageId: "nondeterministicSource",
                        data: { source: `${root}.now` },
                    });
                }
            },
            NewExpression(node) {
                if (node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0) {
                    context.report({ node, messageId: "unseededDate" });
                }
            },
        };
    },
});
