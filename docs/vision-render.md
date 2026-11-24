# Current vision render — 24 Nov 2026

This is an inspected browser render, not a model-level assertion.

## How it was served

```sh
FACTORY_HOME=/tmp/vision-factory-home4 \
  node --conditions=development packages/board/src/cli.ts up \
  --root /tmp/vision-shop3 --port 4811 --host 127.0.0.1 --detach
```

The factory home contains `permissions-dog4` and `enterprise-dog4`; the room root has
two healthy services on 4400/4401, and each workstream has a preview route.

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
  enterprise-dog4  Done  checkpoint b5cbcdfa
  permissions-dog4 Done  checkpoint 9da1dffd
  ENVIRONMENT
  port 4401 · web healthy · preview /preview/enterprise-dog4/
  port 4400 · web healthy · preview /preview/permissions-dog4/
  NEEDS YOU  Ready to merge PR #9903
```

Screenshots are committed beside this note:

- `docs/vision-2026-11-24.png`
- `docs/factory-2026-11-24.png`

The pages are client-rendered; the text above came from the browser after hydration, not
from the HTML shell.
