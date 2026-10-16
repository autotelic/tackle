import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";

/**
 * Whether a symbol name contains the forbidden substring.
 *
 * @param {string} name - The symbol name to inspect.
 * @returns {boolean} True when the name contains the forbidden term.
 */
function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/** Ban the case-insensitive substring "shape" in every JavaScript and TypeScript symbol name. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in JavaScript, TypeScript, private, and JSX symbol names.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const reportForbiddenSymbolName = (node: ESTree.Node & { name: string }) => {
      if (!containsForbiddenSymbolName(node.name)) return;
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    return {
      Identifier: reportForbiddenSymbolName,
      PrivateIdentifier: reportForbiddenSymbolName,
      JSXIdentifier: reportForbiddenSymbolName,
    };
  },
});
