import { defineRule } from "@oxlint/plugins";
import { readField } from "../shared/structural.js";
/**
 * Dense representations are sliceable on any axis because their parts are
 * named. Past two elements, positional tuples hide which position carries
 * which fact: swap-prone, unreadable at call sites, and impossible to
 * slice meaningfully. Give wide tuples a named shape.
 */
export const noAnonymousWideTuplesRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Disallow anonymous tuple types of three or more elements; use a named object so every field's role is explicit.",
        },
        messages: {
            wideTuple: "This {{count}}-element tuple leaves {{count}} unnamed positions whose meaning lives only in the reader's head. Declare a named object (or tagged union) instead so fields are self-describing.",
        },
    },
    createOnce(context) {
        return {
            TSTupleType(node) {
                const elements = readField(node, "elementTypes") ?? [];
                const count = elements.length;
                if (count < 3)
                    return;
                context.report({
                    node,
                    messageId: "wideTuple",
                    data: { count: String(count) },
                });
            },
        };
    },
});
