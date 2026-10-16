import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.ts";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const commentOwnerKinds = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `SAFETY:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
  },
  createOnce(context) {
    const checkAssertion = (node: TypeAssertion) => {
      const isConstAssertion =
        node.typeAnnotation.type === "TSTypeReference" &&
        node.typeAnnotation.typeName.type === "Identifier" &&
        node.typeAnnotation.typeName.name === "const";
      if (isConstAssertion) return;
      const ancestors = ancestorsOf(context.sourceCode, node);
      const chain: Array<ESTree.Node> = [node, ...[...ancestors].reverse()];
      let justified = false;
      for (let index = 0; index < chain.length; index += 1) {
        const current = chain[index]!;
        if (
          context.sourceCode
            .getCommentsBefore(current)
            .some((comment) => comment.end <= node.start && /\bSAFETY\s*:/u.test(comment.value))
        ) {
          justified = true;
          break;
        }
        if (commentOwnerKinds.has(current.type)) break;
        const parent = chain[index + 1];
        if (parent === undefined || parent.type === "Program") break;
      }
      if (!justified) context.report({ node, messageId: "missingSafetyComment" });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
