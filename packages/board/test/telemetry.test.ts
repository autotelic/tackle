/* oxlint-disable plumb/prefer-property-tests -- one fixed session transcript; the decode is the assertion. */
import { expect, test } from "vitest"
import { telemetryOfSession } from "../src/factory/telemetry.ts"

test("a session transcript yields wall, model, tool, operation, and token telemetry", () => {
  const session = "factory-projects-list-1862-20261124T180000Z.jsonl"
  const lines = [
    {
      type: "message",
      timestamp: "2026-11-24T18:00:00.000Z",
      message: {
        role: "assistant",
        durationMs: 1000,
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cost: { total: 0.01 },
        },
        content: [
          { type: "toolCall", arguments: { code: "jig check --format json" } },
          { type: "toolCall", arguments: { code: "pi.edit({path:'x'})" } },
          { type: "toolCall", arguments: { code: "git commit -m x" } },
          { type: "toolCall", arguments: { code: "git push origin x" } },
        ],
      },
    },
    {
      type: "message",
      timestamp: "2026-11-24T18:00:10.000Z",
      message: { role: "toolResult", durationMs: 2000 },
    },
  ]
  const result = telemetryOfSession({
    session,
    text: lines.map((line) => JSON.stringify(line)).join("\n"),
  })
  expect(result).toMatchObject({
    workstream: "projects-list-1862",
    wallSeconds: 10,
    modelSeconds: 1,
    toolSeconds: 2,
    turns: 1,
    toolCalls: 4,
    measurementCalls: 1,
    editCalls: 1,
    commits: 1,
    pushes: 1,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    costUsd: 0.01,
  })
})
