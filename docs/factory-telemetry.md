# Factory telemetry

The first cut reads the session logs and receipts the factory already leaves on disk. It answers the
question a status line cannot: **where did the minutes go?**

```sh
factory telemetry --since 2026-11-24T17:30:00Z
factory telemetry --since 2026-11-24T17:30:00Z --json
factory telemetry --since 2026-11-24T17:30:00Z --check
```

`--check` exits non-zero and names the session when a pass used `mcp__browse` against a
`linear.app` URL. That is a tool-policy violation: Linear documents are read through the Linear
MCP, not the browser.

One row is one worker session:

```text
workstream  start  wall  model  tool  calls  measure  edit  commit  cost
```

- **wall** — first to last timestamp in the session.
- **model** — sum of assistant `durationMs`.
- **tool** — sum of tool-result `durationMs`.
- **calls** — assistant tool calls.
- **measure** — calls whose code contains `jig check` or `joggle`.
- **edit / commit / push** — the corresponding operation appears in the call code.
- **tokens / cacheRead / cost** — summed from the message usage blocks.

The parser is deliberately forgiving: a malformed line is skipped, because telemetry is an
observation and must not become a gate. A missing session is an empty row, not a false zero.

## What we have now

```text
Pi session logs   wall, model/tool duration, turns, tool mix, tokens, cost
receipts          pass, start, status, checkpoint, gate counts, events
workstream record phase, budget, checkpoint, label, PR
process table     worker pid, wall age, terminal name
daemon log        append/pass counts, timeout and name_taken errors
```

## The telemetry we want next

The receipt is the right home for the durable version, because it survives the session file.

```ts
interface PassTelemetry {
  pass: number
  startedAt: string
  endedAt: string
  queueWaitMs: number // event at -> pass start
  modelMs: number
  toolMs: number
  gateMs: number // before + after, separately when cache misses
  gateCache: "hit" | "miss"
  turnCount: number
  measurementCalls: number
  editCalls: number
  commit?: string
  pushed: boolean
  labelApplied: boolean
  linearState?: string
  noProgress: number // trailing identical receipt signatures
}
```

The kernel can fill this without parsing a transcript:

1. Stamp `FACTORY_PASS` and `FACTORY_TELEMETRY` in the worker environment.
2. Have the worker emit a small JSONL sidecar, or have the kernel time the existing calls and attach
   only the kernel-owned fields.
3. Write the merged object in the receipt at completion, and expose the last pass on `/presence`.
4. Aggregate by workstream: median wall, p50/p95 queue wait, percent tool time, measurement share,
   commits per pass, and cost per landed ticket.
5. Put the same numbers on the floor card as a sparkline and a “last push” timestamp; a long model
   turn and a long test run should look different at a glance.

The next useful alert is not “pass is old”. It is “this pass spent 80% of its wall time in tools and
has made no commit”, or “the same gate signature has repeated three times”. Both are already derivable
from the fields above.
