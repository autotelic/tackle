import { expect, test } from "vitest"
import * as Result from "effect/Result"
import { recordOf } from "../src/factory/store.ts"
import { githubEvents } from "../src/factory/watch.ts"

test("a conflicting PR is a wake event tied to its head and base", () => {
  const record = recordOf({
    id: "permissions-1862",
    facts: {
      project: "P-AUT-128",
      label: "permissions-overhaul",
      repo: "Shakti-Reforestation/forestbuilder",
      path: "/tmp/shakti-perms",
      branch: "feature/permissions-overhaul",
      head: "abc",
      delivery: "pr",
      pr: 1862,
      base: "develop",
      baseSha: "def",
      prHead: "abc",
      phase: "build",
      at: "2026-11-21T00:00:00.000Z",
      checkpoint: { sha: "abc", ref: "refs/bench/permissions-1862", at: "…", pushed: false },
    },
  })
  const events = githubEvents({
    record,
    at: "2026-11-23T12:00:00.000Z",
    runGh: () =>
      Result.succeed(
        JSON.stringify({
          headRefOid: "abc",
          baseRefOid: "def",
          mergeable: "CONFLICTING",
          mergeStateStatus: "DIRTY",
          reviews: [],
          comments: [],
        }),
      ),
  })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    id: "github:conflict:abc:def",
    kind: "merge-conflict",
    at: "2026-11-23T12:00:00.000Z",
    headSha: "abc",
  })
})

test("a PR comment with a GitHub string id is an event", () => {
  const record = recordOf({
    id: "permissions-1862",
    facts: {
      project: "P-AUT-128",
      label: "permissions-overhaul",
      repo: "Shakti-Reforestation/forestbuilder",
      path: "/tmp/shakti-perms",
      branch: "feature/permissions-overhaul",
      head: "abc",
      delivery: "pr",
      pr: 1862,
      base: "develop",
      baseSha: "def",
      prHead: "abc",
      phase: "build",
      at: "2026-11-21T00:00:00.000Z",
      checkpoint: { sha: "abc", ref: "refs/bench/permissions-1862", at: "…", pushed: false },
    },
  })
  const events = githubEvents({
    record,
    at: "2026-11-23T12:00:00.000Z",
    runGh: () =>
      Result.succeed(
        JSON.stringify({
          headRefOid: "abc",
          reviews: [],
          comments: [
            {
              id: "IC_kwDOK7o5SM8AAAABqgFuVA",
              body: "Please fix this",
              createdAt: "2026-11-23T11:00:00Z",
              author: { login: "eadmundo" },
            },
          ],
        }),
      ),
  })
  expect(events).toHaveLength(1)
  expect(events[0]?.kind).toBe("comment")
  expect(events[0]?.id).toBe("github:comment:IC_kwDOK7o5SM8AAAABqgFuVA")
})

test("a submitted review with a string id is an event", () => {
  const record = recordOf({
    id: "permissions-1862",
    facts: {
      project: "P-AUT-128",
      label: "permissions-overhaul",
      repo: "Shakti-Reforestation/forestbuilder",
      path: "/tmp/shakti-perms",
      branch: "feature/permissions-overhaul",
      head: "abc",
      delivery: "pr",
      pr: 1862,
      base: "develop",
      baseSha: "def",
      prHead: "abc",
      phase: "build",
      at: "2026-11-21T00:00:00.000Z",
      checkpoint: { sha: "abc", ref: "refs/bench/permissions-1862", at: "…", pushed: false },
    },
  })
  const events = githubEvents({
    record,
    at: "2026-11-23T12:00:00.000Z",
    runGh: () =>
      Result.succeed(
        JSON.stringify({
          headRefOid: "abc",
          reviews: [
            {
              id: "PRR_kwDOK7o5SM8AAAABZoIWoA",
              state: "COMMENTED",
              body: "# Review",
              submittedAt: "2026-11-22T22:04:42Z",
            },
          ],
          comments: [],
        }),
      ),
  })
  expect(events).toHaveLength(1)
  expect(events[0]?.id).toBe("github:review:PRR_kwDOK7o5SM8AAAABZoIWoA")
})
