import { expect, it, test } from "@effect/vitest"
import { Effect, Path } from "effect"
import { NodeServices } from "@effect/platform-node"
import { matchesGlob } from "../src/config.ts"
import { isIgnored, orderRules, parseGitignore } from "../src/gitignore.ts"
import { globSource } from "../src/glob.ts"

test("the config syntax treats a question mark as a literal", () => {
  expect(globSource("a?b", { question: false, doubleStarSkipsSlash: false })).toBe("a\\?b")
  expect(matchesGlob({ glob: "react*", subject: "react-dom" })).toBe(true)
  // A star stops at a separator.
  expect(matchesGlob({ glob: "react*", subject: "react/dom" })).toBe(false)
  expect(matchesGlob({ glob: "react", subject: "react-dom" })).toBe(false)
})

test("the gitignore syntax treats a question mark as one character", () => {
  expect(globSource("a?b", { question: true, doubleStarSkipsSlash: false })).toBe("a[^/]b")
})

test("a double star with a slash differs by syntax, on purpose", () => {
  // Config requires the slash between; gitignore absorbs it so zero directories
  // match too. Both behaviours are pinned so a later unification cannot change
  // one of them silently.
  expect(globSource("a/**/b", { question: false, doubleStarSkipsSlash: false })).toBe("a/.*/b")
  expect(globSource("a/**/b", { question: true, doubleStarSkipsSlash: true })).toBe("a/.*b")
})

it.effect("a gitignore rule matches at any depth, and a negation undoes it", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const rules = orderRules(parseGitignore({ text: "generated/\n*.min.js\n!keep.min.js\n", base: ".", depth: 0 }))
    expect(isIgnored(rules, path.resolve("generated/x.ts"), path)).toBe(true)
    expect(isIgnored(rules, path.resolve("a/b.min.js"), path)).toBe(true)
    expect(isIgnored(rules, path.resolve("a/keep.min.js"), path)).toBe(false)
    expect(isIgnored(rules, path.resolve("a/b.ts"), path)).toBe(false)
  }).pipe(Effect.provide(NodeServices.layer)),
)
