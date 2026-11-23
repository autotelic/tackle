# 0062 — TAC-15 — there is no agent to find

`docs/worker-invocation.md`, written from the source of the runner you already have.

**`Agent not found: build` is opencode2's registry, not a missing piece of the factory.** The worker path is
`packages/treadle/src/run-session.ts`: one Session through the Pi SDK.

```sh
node packages/treadle/src/run-session.ts \
  --repo ~/autotelic/shakti-perms --cwd ~/autotelic/shakti-perms \
  --config ~/.factory/configs/perms-1862-pass-7.ts \
  --prompt-file ~/.factory/prompts/perms-1862-pass-7.md \
  --max-turns 200 --timeout-minutes 30 --ask-timeout-minutes 30 \
  --log ~/.factory/logs/perms-1862-pass-7.ndjson
# 0 completed · 1 failed · 2 blocked-on-human
```

So the question is **which model**, not which agent. `ModelRuntime.getModel(provider, id)` runs before any session
exists and refuses with `model not in catalog: provider/id` — a good failure, because it happens before a pass is
charged. `docs/seam.md` already maps `desired.model` into the generated config; that mapping is the fix.

If opencode is ever a worker, it is a second `WorkerRunner` implementation that owns its agent names internally —
not an agent vocabulary the kernel learns and then has to keep in sync with someone else's phase names.

**Two other things the source surfaces:**

1. **exit codes are the whole contract:** `0` → receipt + checkpoint; `1` → pass **charged**, recorded failed, two
   in a row raises a desk item; `2` → **no checkpoint**, a desk item, phase `blocked`; `64` → our bug, not a state.
2. **the human channel is terminal stdin “until #14”** — fatal for an unattended kernel. One adapter fixes it:
   `askHuman` writes a desk item and waits for an answer record; timeout → exit `2`, so the kernel parks honestly
   instead of the worker hanging.

**Smokes that unblock P0**, both against the adopted worktree: (a) a prompt that reports the branch and changes
nothing — expect `0`, a receipt, and an empty `git status`; (b) a prompt that asks a question with
`--ask-timeout-minutes 1` — expect `2` and one desk item. Once those two pass, every other layer sits on top of
them.

Also per your ruling: `docs/signals.md` now carries **`experience.report` as its own record** with its own action
path (desk item, not `board apply`) and four refusals — `NoAttribution`, `TooFewSamples`, `BelowThreshold`,
`InSettleWindow`. `board apply` keeps its five and its single purpose.

**Open question:** does the kernel want to own the prompt file, or should the worker compose it from the event and
the workstream record? My vote: the kernel writes it — one generated artifact per pass is what makes a receipt
reproducible, and a worker that composes its own prompt is a worker that can drift from the phase.
