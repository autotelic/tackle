import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";

/**
 * Whether a name contains the forbidden substring.
 *
 * @param {string} name - The name to inspect.
 * @returns {boolean} True when the name contains the forbidden term.
 */
function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/**
 * Ban the case-insensitive substring "shape" in the names a package CHOOSES.
 *
 * The rule used to fire on every Identifier, which made it flag a member read
 * (`unit.shape`) and an import of someone else's export. Neither is a name this
 * package chose: renaming them is not its decision, and the only way to satisfy
 * the rule was to spell the read `unit["shape"]`, which is worse code. It stays
 * in scope at declaration sites, which is where a name is introduced.
 */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in the names JavaScript and TypeScript declarations introduce.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    /**
     * Report a name node when it carries the forbidden term.
     *
     * The node type is the narrowing: only the three identifier kinds carry a
     * string `name`, so a literal key or a computed expression falls out here
     * without a runtime type test.
     *
     * @param {ESTree.Node | null | undefined} candidate - The node that should be a name, if it is one.
     * @returns {void}
     */
    const check = (candidate: ESTree.Node | null | undefined): void => {
      if (candidate === null || candidate === undefined) return;
      if (
        candidate.type !== "Identifier" &&
        candidate.type !== "JSXIdentifier" &&
        candidate.type !== "PrivateIdentifier"
      ) {
        return;
      }
      if (!containsForbiddenSymbolName(candidate.name)) return;
      context.report({
        node: candidate,
        messageId: "forbiddenSymbolName",
        data: { name: candidate.name },
      });
    };

    /**
     * Report every name a binding pattern introduces.
     *
     * @param {ESTree.Node | null | undefined} pattern - A binding pattern.
     * @returns {void}
     */
    const checkPattern = (pattern: ESTree.Node | null | undefined): void => {
      if (pattern === null || pattern === undefined) return;
      check(pattern);
      if (pattern.type === "ArrayPattern") {
        for (const element of pattern.elements) checkPattern(element);
        return;
      }
      if (pattern.type !== "ObjectPattern") return;
      for (const property of pattern.properties) {
        if (property.type === "Property") checkPattern(property.value);
        else checkPattern(property.argument);
      }
    };

    return {
      VariableDeclarator: (node) => {
        checkPattern(node.id);
      },
      FunctionDeclaration: (node) => {
        check(node.id);
      },
      FunctionExpression: (node) => {
        check(node.id);
      },
      ClassDeclaration: (node) => {
        check(node.id);
      },
      ClassExpression: (node) => {
        check(node.id);
      },
      TSInterfaceDeclaration: (node) => {
        check(node.id);
      },
      TSTypeAliasDeclaration: (node) => {
        check(node.id);
      },
      TSEnumDeclaration: (node) => {
        check(node.id);
      },
      TSPropertySignature: (node) => {
        check(node.key);
      },
      TSMethodSignature: (node) => {
        check(node.key);
      },
      PropertyDefinition: (node) => {
        check(node.key);
      },
      MethodDefinition: (node) => {
        check(node.key);
      },
      Property: (node) => {
        check(node.key);
      },
    };
  },
});
