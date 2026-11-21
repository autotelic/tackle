# Invoking a worker: a model, not an agent

Written while the P0/P1 loop is blocked on `Agent not found: build` from an opencode smoke. Read the source: the
worker runner already exists, and it does not have agents.

---

## 1. What the worker actually is

Treadle drives **one Session through the Pi SDK** (`packages/treadle/src/run-session.ts` → `session.ts`):

```sh
node packages/treadle/src/run-session.ts \
  --repo   ~/autotelic/shakti-perms \
  --cwd    ~/autotelic/shakti-perms \
  --config ~/.factory/configs/perms-1862-pass-7.ts \
  --prompt-file ~/.factory/prompts/perms-1862-pass-7.md \
  --max-turns 200 --timeout-minutes 30 --ask-timeout-minutes 30 \
  --log    ~/.factory/logs/perms-1862-pass-7.ndjson

# exit 0 = completed, 1 = failed, 2 = blocked-on-human
```

`run-loop.ts` is the whole-loop variant. Caps default from the config's `budgets`, so the kernel passes them only
when it wants to be stricter than the workstream's own budget.

## 2. There is no agent to find

`Agent not found: build` is **opencode2's** registry talking. `build` and `plan` are its agent names. Nothing in the
worker path consults them: Treadle spawns a Pi session and Pi has no agent registry in this mode — it has
**models**.

So the question the kernel must answer is _which model_, not which agent:

```jsonc
// generated config, from docs/seam.md
{ "model": { "provider": "anthropic", "id": "claude-sonnet-4-5" } }
```

and the resolution is already strict in the right way: `ModelRuntime.getModel(provider, id)` runs **before any
session exists**, and an unknown pair refuses with `model not in catalog: <provider>/<id>`. That refusal is the
good failure: it happens before a pass is charged.

**If opencode is ever wanted as a worker**, it is a second implementation behind one port — `WorkerRunner` with
`pi` and `opencode` variants, selected by `desired.worker` and defaulting to `pi` — and the opencode variant owns
its own agent names inside itself. What must not happen is the kernel learning an agent vocabulary it then has to
keep in sync with a different tool's phase names.

---

## 3. Exit codes are the whole kernel contract

| worker exit          | what the kernel does                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `0` completed        | write the receipt, checkpoint (`refs/bench/<id>` + `VACUUM INTO`), advance the cursor                       |
| `1` failed           | the pass is **charged** and recorded as failed/interrupted; a second consecutive failure raises a desk item |
| `2` blocked-on-human | **no checkpoint**; the question becomes a desk item, the phase becomes `blocked`                            |
| `64` usage           | the kernel generated a bad command — a bug, `infrastructure`, never a workstream state                      |

That is a smaller surface than it looks: `2` is the only exit that creates a desk item, and `1` is the only one
that may repeat.

---

## 4. The prompt file

The kernel writes `~/.factory/prompts/<id>-pass-<n>.md` and passes its path — never a shell-quoted string, and never
the transcript.

```md
# Pass 7 · perms-1862 · phase build

## The one task

Implement refusal responses for the read-policy endpoints (P-AUT-241).

## What woke this pass

review.comment 2048113377 on PR 1862, authored against 7c1d0e9 (current head 55aa5293).
“The refusal path returns 409 here but the doc says 403. Which is it?”

## Constraints

- Do not edit the project description or the SOW.
- Do not merge. Prepare; a human lands it.
- Checks: `jig check`, `pnpm test`. Your pass is refused if warnings/errors rise.

## Where things are

repo ~/autotelic/shakti-perms · PR 1862 · baseline .jig-baseline.json · report .factory/reports/…
```

What it must **not** contain: credentials (the environment carries them, and the config names no secret), the whole
conversation, an instruction to merge, or any lease/generation value — a worker that knows the generation will try
to use it (`docs/seam.md` §3).

## 5. The gap this exposes: the human channel

`run-session.ts` says it plainly: _“The human channel is the terminal until #14: answer ask_human questions on
stdin.”_ That is fine for a person at a keyboard and **fatal for an unattended kernel**: a pass that asks a human
will sit on stdin until its timeout.

So P1.5 is one adapter, not a redesign — a `HumanChannel` whose `askHuman` writes a desk item and waits for an
answer record:

```
askHuman(question, options?) → desk.item { kind: "decision" | "blocked", choices } → wait(answer | timeout)
   answer   → the pass continues with the text
   timeout  → exit 2, so the kernel parks the phase honestly instead of the worker hanging
```

Until that exists, the honest smoke is `askHumanTimeoutMinutes: 1` and an expectation of exit `2`.

## 6. The smoke that unblocks P0

Two runs, both against the _adopted_ worktree and both cheap:

1. **trivial completion** — `--prompt-file` containing “report the branch name and exit; change nothing”, expect
   `0`, a receipt, and an empty `git status` in the worktree.
2. **deterministic block** — a prompt that asks the human a question, `--ask-timeout-minutes 1`, expect `2` and one
   desk item in the record.

If (1) passes and (2) returns `2`, the kernel can run a pass. Everything else — signals, Slack, the reconciler —
sits on top of those two facts.
