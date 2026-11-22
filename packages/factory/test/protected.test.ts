import { expect, test } from "vitest"
import { isProtectedPath } from "../src/kernel.ts"
import { recordOf } from "../src/store.ts"

const record = (protectedPaths: ReadonlyArray<string>) =>
  recordOf({
    id: "probe",
    facts: {
      project: "factory",
      label: "factory-feedback",
      repo: "autotelic/tackle",
      path: "/tmp/tackle",
      branch: "main",
      head: "abc",
      delivery: "trunk",
      pr: undefined,
      base: "main",
      baseSha: "abc",
      prHead: "abc",
      phase: "build",
      at: "2026-11-22T00:00:00.000Z",
      checkpoint: { sha: "abc", ref: "refs/bench/probe", at: "…", pushed: false },
    },
  })

test("a directory pattern protects its children, not a sibling with the same prefix", () => {
  const subject = { record: record(["packages/factory/**"]), path: "" }
  expect(isProtectedPath({ ...subject, path: "packages/factory/src/kernel.ts" })).toBe(true)
  expect(isProtectedPath({ ...subject, path: "packages/factory-view/src/main.ts" })).toBe(false)
})

test("an exact pattern protects only that path", () => {
  const subject = { record: record(["package.json"]), path: "" }
  expect(isProtectedPath({ ...subject, path: "package.json" })).toBe(true)
  expect(isProtectedPath({ ...subject, path: "packages/factory-view/package.json" })).toBe(false)
})
