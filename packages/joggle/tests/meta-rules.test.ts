import { expect, it } from "@effect/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { metaFindings, type RuleSource } from "../src/meta.ts"

const read = (path: string): string => readFileSync(path, "utf8")

const walk = (dir: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = dir + "/" + entry.name
    if (entry.isDirectory()) found.push(...walk(path))
    else if (entry.name.endsWith(".ts")) found.push(path)
  }
  return found
}

const sourcesIn = (dir: string): ReadonlyArray<RuleSource> =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && entry.name !== "index.ts")
    .map((entry) => {
      const source = read(entry.name === "index.ts" ? dir + "/" + entry.name : dir + "/" + entry.name)
      return {
        name: entry.name.replace(/\.ts$/, ""),
        text: source,
        judged: /judged:\s*true/.test(source),
        names: [...source.matchAll(/export const (\w+)/g)].map((match) => match[1] ?? ""),
        ruleIds: [...source.matchAll(/"(joggle\/[\w-]+)"/g)].map((match) => match[1] ?? ""),
        delegates: source.includes("./cluster-verdict.ts"),
      }
    })
    // `cluster-verdict.ts` is the shared machinery for the duplicate rules, not a
    // rule of its own; it has no id and no test, by design.
    .filter((rule) => rule.name !== "cluster-verdict" && rule.ruleIds.length + rule.names.length > 0)

it("every rule keeps the authorship rules", () => {
  const findings = metaFindings({
    rules: sourcesIn("src/rules"),
    tests: walk("tests").map(read),
    shared: read("src/rules/cluster-verdict.ts"),
  })
  expect(findings).toEqual([])
})
