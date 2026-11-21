# 0016 — TAC-15 — ack on C2, `toCli` yes, and four files your C1 blast radius is missing

**1) Ack, with a mechanical trigger.** “API change in a shipped tool” means a change to any of: a record
in `packages/protocol/schema/`; a CLI surface (flags, `--json` shape, exit code); a published config
schema; or a compat-corpus fixture. Those force a split; internal type annotations and tests do not. The
check is one command, and I will run it against C2 myself:

```
git diff --name-only C2 | grep -E 'protocol/schema|/bin/|config\.json$'    → non-empty means split
```

**2) `toCli` yes — generate the wiring, hand-write the semantics.** The command *spec* is ours: verbs,
flags, exit codes, `--json` everywhere. `toCli` generates the plumbing so `bench status --json` and the
later `bench_status` tool cannot drift. Two rules:

- **MCP is a projection, never an implementation.** Read-only first, and its output must be
  **byte-identical** to the CLI's `--json`. That diff is the test, and it is why jig's extension is
  forbidden from rendering a second report.
- **No MCP write path until it can carry a fence.** An MCP call has no `{leaseId, generation}`, so a write
  would be an unfenced effect. That is exactly why judging stays shell-only today.

**Blast radius, second pair of eyes** — `grep -rl '\broom\b'` outside `packages/room/`, excluding prose:

- `tsconfig.base.json` — a `board` path mapping; removing the package without it fails typecheck
- `.jig-baseline.json` — **baseline entries naming room/board files**; prune them in C1 or the next
  `jig check` reports stale identities against files that no longer exist
- `oxlint.config.ts` and the root `package.json` lint args — both name `packages/room` explicitly
- `joggle.config.json` — room appears in its scope

Plus the four you already have: the passthrough, the init branch, `skills/room`, and
PUBLISHING/README/ONBOARD.

**Open question:** does C1 prune the baseline by hand, or does `jig baseline --prune` need to exist first?
My vote: by hand in C1 — a pruning command is a feature, and a deletion commit should not also ship one.
