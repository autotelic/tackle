# ADR 0003 — a room declares capabilities, not a bag of tools

Status: proposed
Date: 2026-11-24

## Context

A factory pass needed a Linear project document. The machine had no Linear MCP server, but the
agent did have a browser MCP. The prompt did not say "Linear documents are Linear tools"; the agent
opened `linear.app` in the browser. The data was visible, so the fallback looked successful.

Executor can own the tool catalog and the credentials. A policy table can block a tool. Neither
answers the question the agent actually had: **is the capability "read a Linear document" present in
this room, and what tool implements it?** A missing capability became a wider capability plus a
plausible guess.

## Decision

A room has a **capability manifest**:

```ts
interface CapabilityManifest {
  required: string[] // fail the room/pass before the agent starts
  optional?: string[]
  resolve: Record<string, Capability> // "linear.read.document" -> one or more concrete tools
  origins?: { "app.browse": string[] } // e.g. the room's preview origin only
}
```

The runtime resolves the manifest to concrete MCP tools and CLIs before the agent is spawned:

- every `required` capability must have a live, authenticated binding, or the pass fails with
  `CapabilityMissing` — it does not start with a smaller toolbox;
- the agent sees the resolved tools, not the host's entire MCP bag;
- `app.browse` is origin-scoped; `linear.app` is not an allowed origin;
- a missing binding names the capability and the attempted server, so the fix is visible.

The prompt still explains the preferred tool, but the prompt is guidance. The manifest is the
boundary.

## Where Executor fits

Executor is the **catalog, credential broker, and approval plane** for the resolved bindings. It can
hold the Linear token and expose `linear_getProjectDocuments`; it can block the browser tool. It
does not become the room's capability authority: the room manifest says what the work needs, and
Executor says which concrete tool and credential satisfy it. That keeps the room record, lease, and
evidence outside an organization account.

## Consequences

- A missing Linear MCP is an explicit failure, not a browser workaround.
- A browser call to a non-app origin is rejected at the tool boundary, not merely detected later.
- The existing `factory telemetry --check` remains the regression detector: it catches a pass that
  used `mcp.browse` against `linear.app`, even if a future runtime forgets the origin guard.
- The manifest is data, not a second policy engine. Approval and authority remain in the existing
  desk/lease paths; applicability belongs to the room.

## Next experiment

Add `required: ["linear.read.document", "github.read.pull-request"]` to one workstream, resolve it
through Executor's MCP endpoint, and prove that removing the Linear binding fails the pass before a
worker starts instead of silently exposing the browser. Then make the browser's origin allowlist a
runtime check and keep the telemetry guard as the audit.
