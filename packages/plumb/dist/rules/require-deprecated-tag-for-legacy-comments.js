import { defineRule } from "@oxlint/plugins";
import { getAllComments } from "../shared/structural.js";
const LEGACY_PROSE = /\b(?:deprecat\w*|legacy|obsolete|superseded|do not use|don't use|no longer (?:used?|supported|maintained))\b/iu;
const DEPRECATED_TAG = /@deprecated\b/iu;
/** Prose-only retirement notes are invisible to tooling; require the machine-readable tag. */
export const requireDeprecatedTagForLegacyCommentsRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Require an @deprecated tag whenever a comment describes code as deprecated/legacy/obsolete/do-not-use; prose-only warnings are invisible to editors and agents, who will otherwise discover and use paths you want retired.",
        },
        messages: {
            missingDeprecatedTag: "This comment calls the code deprecated/legacy but carries no @deprecated tag, so tooling cannot see the retirement. Add `@deprecated` (with a pointer to the replacement) inside THIS comment — a tag in a neighbouring block does not count — or reword the comment to drop the retirement wording.",
        },
    },
    createOnce(context) {
        return {
            Program(node) {
                for (const comment of getAllComments(context.sourceCode)) {
                    if (comment.type !== "Block")
                        continue;
                    if (!LEGACY_PROSE.test(comment.value))
                        continue;
                    if (DEPRECATED_TAG.test(comment.value))
                        continue;
                    context.report({
                        node,
                        messageId: "missingDeprecatedTag",
                    });
                }
            },
        };
    },
});
