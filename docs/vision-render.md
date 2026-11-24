# Current vision render — 24 Nov 2026

This is an inspected browser render, not a model-level assertion.

## How it was served

```sh
FACTORY_HOME=/tmp/vision-factory-home5 \
  node --conditions=development packages/board/src/cli.ts up \
  --root /tmp/vision-shop3 --port 4811 --host 127.0.0.1 --detach
```

The factory home contains `permissions-dog5` and `enterprise-dog5`; the room root has
two healthy services on 4400/4401, and each workstream has a preview route. Both are done
and the ready desks are closed.

## Browser evidence

The `browse` MCP opened `/vision` and `/factory` and returned the rendered text. The
important parts:

```text
/vision
  Current state
  WORKS  main · pnpm check · jig check · CI green
  WORKS  factory loop · check events · quality follow-up · ready + merge retirement
  WORKS  agentOS · embedded VM · own filesystem/process · no Rivet credentials
  NOT BUILT  two-project launch · runbook ready · blocked on target gate decision
  The technology seam
  ...
  orb lifecycle · spawn / pause / delete provider contract; borrowed from Amp

/factory
  2 workstreams · 1 repo
  enterprise-dog5  Done  checkpoint e8a695dc
  permissions-dog5 Done  checkpoint 485769a1
  ENVIRONMENT
  port 4401 · web healthy · preview /preview/enterprise-dog5/
  port 4400 · web healthy · preview /preview/permissions-dog5/
  desk: empty
```

Screenshots are committed beside this note:

- `docs/vision-2026-11-24.png`
- `docs/factory-2026-11-24.png`

The pages are client-rendered; the text above came from the browser after hydration, not
from the HTML shell.
