# @autotelic/factory-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed.

It is a Foldkit application. State arrives as one `/presence` read; every
transition is a message, and the UI has no local source of truth.

## Shape

```
/presence  ──decode──▶  Presence
                         ├─ observedAt           the instant the board read every source
                         ├─ factory.workstreams  id, repo, phase, pr, cursors, checkpoint
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual
                         └─ sessions             herdr / rex addresses + workstream
```

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

`presence.ts` is that contract and `repos.ts` is the only projection of it: the
repo panel, its counts, and the sentences that state them. Neither ages anything
with the browser clock — every age is measured from `observedAt`, so two people
reading the same document read the same ages.

## Run it

The board serves the built view at `/factory`:

```sh
pnpm --filter @autotelic/factory-view build
board up --root .room --host 127.0.0.1 --port 4780
open http://127.0.0.1:4780/factory
```

`build` runs the suite and then bundles; `bundle` is the bundle alone when you only
want `dist/`.

For UI work, run Vite with the board already up:

```sh
pnpm --filter @autotelic/factory-view dev
# http://127.0.0.1:4782/ — proxies /presence to 4780
```

## What each row means

The page starts with the kernel's state machine and the current count in each
phase. Below it, workstreams are grouped by **repository**, and each repo is a
panel with a sentence for a header:

```
acme/web · 2 workstreams (1 live, 2 unobserved since Tue) · 1 PR
gate: not in /presence · missing baseline identity count, error and warning counts, newest accepted identity
```

- **The header sentence** counts the workstreams, how many have a live session,
  and how many are **unobserved** — always with the denominator, so `all
  observed` and `0 live` are stated rather than implied. The two counts are
  disjoint: `live` is a session attached now, and a live workstream is being
  looked at whatever its cursors say. A repo with no
  workstreams named in the document is `unfiled`, sorted last: a workstream the
  document does not name a repo for is a section, never a dropped row.
- **Unobserved is not stale.** A workstream is unobserved when no cursor has
  advanced since adoption (`cursors.github`, `cursors.linear`, `cursors.reports`
  are the store's empty strings). It says `not observed — no cursor advanced` on
  the card — `live now — no source read yet` when a session is attached — and
  the header dates the bucket from the latest adoption in it: `since Tue`, or
  `last looked 3h ago` within the day.
- **The gate is named when it is missing.** `/presence` carries no gate today:
  no baseline identity count, no error or warning counts, no newest accepted
  identity. The panel says exactly that per repo instead of showing a number it
  does not have. PR state is missing the same way: a PR number is on the wire,
  whether it is open or merged is GitHub's. The report is filed against this
  workstream; when `board` serves the fields, the sentence gains them.
- **Workstreams** — one card per adopted workstream, in phase order. `phase` is
  the kernel's state; `checkpoint` is the commit the last pass stopped at, aged
  from `observedAt` (`checkpoint 9f1c2ab8 · 12m ago`), or `no checkpoint yet`.
  The matching live sessions sit inside the card, so the jump to the conversation
  is on the workstream itself. A session joins by an explicit
  `workstream=<id>` label, by cwd inside the workstream path, or by the words in
  its tab title; an unmatched session stays in the bottom list rather than
  being guessed onto a workstream.
- **Desk** — questions waiting for a human. The view does not answer them; it
  shows which workstream asked.
- **Sessions** — Herdr and Rex addresses. `Open` asks the board to focus the
  session in its app: a Rex block is focused by block id, and a Herdr terminal
  is attached in Terminal with `hc attach …`. `Copy` gives the command instead.
  Sessions with no evidence of a workstream are listed separately, never
  assigned by guesswork.
- **Reports** — structured feedback the factory consumed, with expected and
  actual text side by side.

The refresh button is deliberate: this is an observation surface, not a
controller. The only action is `POST /open`, which validates the address and
runs `rex block focus` or `hc attach`; factory state is never written here.

## Tests

`pnpm --filter @autotelic/factory-view test` runs the projection and the rendered
view. `repos.test.ts` asserts the grouping as a partition over generated
documents (fast-check), so "a workstream with no repo is not dropped" is a
property, not three examples. `view.test.ts` renders the real view through
Foldkit's scene harness and reads it as text — no browser.

The suite also writes vitest's JSON report to `.treadle/reports/unit.json`, and
`build` runs it before bundling. That is deliberate: the treadle loop's Checks run
only jig and this build, while its Feature-done guard counts new tests from that
report. A build that skipped the suite would leave the guard reading zero, so the
view's build gate is the tests plus the bundle. `.treadle/` is local state and
gitignored; the report never enters the branch.
