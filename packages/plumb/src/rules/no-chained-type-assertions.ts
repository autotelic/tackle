import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.ts";

type TypeAssertionExpression = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

/** Disallow nested TypeScript type assertions, while permitting chains made only of const assertions. */
export const noChainedTypeAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow chained TypeScript as and angle-bracket assertions, including parenthesized chains.",
    },
    messages: {
      chained:
        "This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.",
    },
  },
  createOnce(context) {
    const checkTypeAssertion = (node: TypeAssertionExpression) => {
      const ancestors = ancestorsOf(context.sourceCode, node);

      let current: ESTree.Expression = node;
      let index = ancestors.length - 1;
      while (index >= 0) {
        const parent = ancestors[index]!;
        if (parent.type !== "ParenthesizedExpression" || parent.expression !== current) break;
        current = parent;
        index -= 1;
      }
      const outermost = ancestors[index];
      if (
        outermost !== undefined &&
        (outermost.type === "TSAsExpression" || outermost.type === "TSTypeAssertion") &&
        outermost.expression === current
      )
        return;

      let assertionCount = 0;
      let hasNonConstAssertion = false;
      current = node;
      while (current.type === "TSAsExpression" || current.type === "TSTypeAssertion") {
        assertionCount += 1;
        const { typeAnnotation } = current;
        hasNonConstAssertion ||= !(
          typeAnnotation.type === "TSTypeReference" &&
          typeAnnotation.typeName.type === "Identifier" &&
          typeAnnotation.typeName.name === "const"
        );
        let next: ESTree.Expression = current.expression;
        while (next.type === "ParenthesizedExpression") next = next.expression;
        current = next;
      }
      if (assertionCount > 1 && hasNonConstAssertion) {
        context.report({ node, messageId: "chained" });
      }
    };

    return {
      TSAsExpression: checkTypeAssertion,
      TSTypeAssertion: checkTypeAssertion,
    };
  },
});
