import { defineRule } from "@oxlint/plugins";
const TEST_FILE = /.(?:test|spec).[cm]?[jt]sx?$|\/test\//u;
/** Raw `try`/`catch` detours failures around the typed error channel; route them through `Effect.try` instead. */
export const noTryCatchRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Disallow raw try/catch; move fallible work behind Effect.try (with a tagged failure reason) or let errors propagate through the typed channel. Unavoidable boundaries justify themselves with a SAFETY comment.",
        },
        messages: {
            tryCatch: "Raw `try`/`catch` detours this failure around the typed error channel. Use `Effect.try` (or `Effect.tryPromise`) failing a tagged reason, or let the error propagate. An integration boundary that must consume throwing APIs justifies itself with a `SAFETY:` comment.",
        },
    },
    createOnce(context) {
        return {
            before() {
                if (TEST_FILE.test(context.filename.replaceAll("\\", "/")))
                    return false;
            },
            TryStatement(node) {
                const justified = context.sourceCode
                    .getCommentsBefore(node)
                    .some((comment) => /\bSAFETY\s*:/u.test(comment.value));
                if (justified)
                    return;
                context.report({ node, messageId: "tryCatch" });
            },
        };
    },
});
