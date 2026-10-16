import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Bare `fetch` reaches past the application boundary un-injected; require a client service. */
export const noDirectFetchRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow direct fetch calls; acquire an HTTP client service (e.g. Effect's HttpClient) so requests are injectable, cancellable, and testable.",
        },
        messages: {
            directFetch: "Bare `fetch` bypasses the injected HTTP client service. Route the request through a client dependency so calls are injectable, cancellable, and testable.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            CallExpression(node) {
                const callee = node.callee;
                if (callee.type === "Identifier" && callee.name === "fetch") {
                    context.report({ node, messageId: "directFetch" });
                    return;
                }
                if (callee.type === "MemberExpression" &&
                    callee.computed !== true &&
                    callee.property.type === "Identifier" &&
                    callee.property.name === "fetch" &&
                    callee.object.type === "Identifier" &&
                    (callee.object.name === "window" || callee.object.name === "globalThis")) {
                    context.report({ node, messageId: "directFetch" });
                }
            },
        };
    },
});
