import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const ASSERTIONS = new Set(["expect", "assert"])

const calleeName = (call: ESTree.CallExpression): string | undefined => {
  if (call.callee.type === "Identifier") return call.callee.name
  if (call.callee.type === "MemberExpression" && !call.callee.computed && call.callee.property.type === "Identifier")
    return call.callee.property.name
  return undefined
}

/**
 * The call a test callback returns, when it returns one at all.
 *
 * @param {ESTree.ArrowFunctionExpression | ESTree.Function} fn - The test callback.
 * @returns {ESTree.CallExpression | undefined} The returned call, or undefined for a synchronous callback.
 */
const returnedCall = (
  fn: ESTree.ArrowFunctionExpression | ESTree.Function,
): ESTree.CallExpression | undefined => {
  if (fn.body === null) return undefined
  if (fn.body.type !== "BlockStatement") return fn.body.type === "CallExpression" ? fn.body : undefined
  const returned = fn.body.body.filter((statement: ESTree.Statement) => statement.type === "ReturnStatement")
  if (returned.length !== 1) return undefined
  const argument = returned[0]?.argument
  return argument?.type === "CallExpression" ? argument : undefined
}

/** An `@effect/vitest` test callback must use `it.effect`, never the sync `test`. */
export const effectTestCannotFloatRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow an @effect/vitest test whose callback returns an Effect through the sync test registration.",
    },
    messages: {
      float:
        "This test builds an Effect and never runs it: use `it.effect(name, ...)`, or keep the test synchronous and assert a value.",
    },
  },
  createOnce(context) {
    const testNames = new Set<string>()
    return {
      Program() {
        testNames.clear()
      },
      ImportDeclaration(node) {
        if (node.source.value !== "@effect/vitest") return
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue
          const imported = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value
          if (imported === "test") testNames.add(specifier.local.name)
        }
      },
      CallExpression(node) {
        const isTest =
          node.callee.type === "Identifier" && testNames.has(node.callee.name)
        const isQualified =
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.object.type === "Identifier" &&
          testNames.has(node.callee.object.name) &&
          node.callee.property.type === "Identifier" &&
          ["only", "skip"].includes(node.callee.property.name)
        if (!isTest && !isQualified) return
        const callback = node.arguments[1]
        if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") return
        const call = returnedCall(callback)
        if (call === undefined) return
        let root: ESTree.Expression = call.callee
        while (root.type === "MemberExpression") root = root.object
        const name = root.type === "CallExpression" ? calleeName(root) : undefined
        if (name !== undefined && ASSERTIONS.has(name)) return
        context.report({ node, messageId: "float" })
      },
    }
  },
})
