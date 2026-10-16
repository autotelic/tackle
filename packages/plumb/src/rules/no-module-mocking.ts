import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";
import { ancestorsOf } from "../shared/ancestors.ts";

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

/**
 * Whether a callee invokes a test framework's module mocking API
 * (`vi.doMock`, `jest.mock`, `vi.unstable_mockModule`), either through the
 * global or through a binding imported from vitest / @jest/globals.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Expression} callee - The visited call expression's callee.
 * @returns {boolean} True when the call mocks a module.
 */
function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type !== "MemberExpression") return false;
  if (callee.object.type !== "Identifier") return false;
  const identifier = callee.object;

  let resolved: Variable | null = null;
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) {
      resolved = variable;
      break;
    }
    scope = scope.upper;
  }
  const isTestFrameworkName = identifier.name === "vi" || identifier.name === "jest";
  let boundToFramework: boolean;
  if (resolved === null || resolved.defs.length === 0) {
    boundToFramework =
      (isTestFrameworkName && sourceCode.isGlobalReference(identifier)) || isTestFrameworkName;
  } else {
    boundToFramework = resolved.defs.some((definition: Variable["defs"][number]) => {
      if (definition.type !== "ImportBinding") return false;
      const importDeclaration = ancestorsOf(sourceCode, definition.node).at(-1);
      if (importDeclaration?.type !== "ImportDeclaration") return false;
      const source = importDeclaration.source.value;
      const specifier = definition.node;
      const importedName =
        specifier.type === "ImportSpecifier"
          ? specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value
          : null;
      return (
        (source === "vitest" && importedName === "vi") ||
        (source === "@jest/globals" && importedName === "jest")
      );
    });
  }
  if (!boundToFramework) return false;

  const property = callee.property;
  const method = callee.computed
    ? property.type === "Literal" &&
      (property.value === "doMock" ||
        property.value === "mock" ||
        property.value === "unstable_mockModule")
      ? property.value
      : null
    : property.type === "Identifier"
      ? property.name
      : null;
  return method !== null && moduleMockMethods.has(method);
}

/** Ban test framework module mocking in favor of real dependency seams. */
export const noModuleMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.",
    },
    messages: {
      moduleMock:
        "Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: "moduleMock" });
        }
      },
    };
  },
});
