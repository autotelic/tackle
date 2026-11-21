import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const INSTANTS = new Set(["at", "now", "timestamp", "occurredAt"])

const keyName = (property: ESTree.ObjectProperty): string | undefined => {
  if (property.computed) return undefined
  return property.key.type === "Identifier" ? property.key.name : undefined
}

/** A Domain command's input must not carry the instant its decide already receives. */
export const noCallerSuppliedInstantRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow at/now/timestamp/occurredAt in Domain.Command input; decide receives { now }.",
    },
    messages: {
      instant:
        "A command may not carry its own instant: `decide` already receives `now`, and two time sources let a caller stamp an earlier state.",
    },
  },
  createOnce(context) {
    const domains = new Set<string>()
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "@alchemy.run/domain") return
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") domains.add(specifier.local.name)
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || node.callee.computed) return
        if (node.callee.object.type !== "Identifier" || !domains.has(node.callee.object.name)) return
        if (node.callee.property.type !== "Identifier" || node.callee.property.name !== "Command") return
        const definition = node.arguments[1]
        if (definition?.type !== "ObjectExpression") return
        const input = definition.properties.find(
          (property): property is ESTree.ObjectProperty =>
            property.type === "Property" && keyName(property) === "input",
        )
        if (input?.value.type !== "ObjectExpression") return
        for (const property of input.value.properties) {
          if (property.type !== "Property") continue
          const name = keyName(property)
          if (name !== undefined && INSTANTS.has(name)) context.report({ node: property, messageId: "instant" })
        }
      },
    }
  },
})
