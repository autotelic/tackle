# Scoping a run to a change

`protocol` does not run git. This file **specifies** the **change set** — the derived record
that says what a run is about — and the two pure matchers that read it. The walk that
produces it (git, `gh`, a subprocess) belongs to whichever tool computes it; the argument
here is that this should be `jig`, once.

This is a proposal. There is no `changeset` schema or fixture yet; the lexicons table in the
README does not list it, because a row for a record no tool writes would be a lie.

## Why a record

Two tools already answer "what changed", and they answer differently.

- `jig`'s `gate.mode: "touched-files"` diffs the working tree against `HEAD`
  (`git diff --name-only HEAD`, plus untracked files).
- `joggle`'s `--since` / `--pr` resolves a **base** — a revision, or a pull request's base
  branch through `gh` — takes the **merge base**, and diffs from there, splitting pure
  renames out.

They are not two spellings of one answer; they are different questions, and a seam is a
format. Two definitions of "changed" drift, and a gate and an engine that disagree about
scope is the false-clean this workspace exists to prevent. The fix is one record, computed
once, read by the gate and by any engine that needs it.

## What the current one gets wrong

`touched-files` measures the working tree against `HEAD`. On a clean checkout of a pull
request — which is what CI does — nothing is modified, so the touched set is **empty**, so
every finding is out of scope, so the gate exits clean. The report still lists the findings;
the exit code is a lie.

`jig` already degrades `touched-files` to `all` when git _fails_. It does not distinguish an
empty answer from an unavailable one. An empty scope has to be as loud as a missing engine:
**"nothing is in scope" is never "clean".**

The second thing `touched-files` cannot do is a base other than `HEAD`, so it can only ever
answer "what is uncommitted", never "what this branch introduced".

## The record

Derived, like the catalog. **Absent means every file is in scope** — a repo that has not
scoped its run has no record to read, and no scope is the honest default.

```json
{
  "lexicon": { "name": "changeset", "version": 1 },
  "base": { "kind": "pr", "number": "412" },
  "changed": ["src/web/router.test.ts", "src/web/router.ts"],
  "renamed": ["src/web/handlers.ts"]
}
```

- `base` is **what the set was measured against**, kept because a report that ran scoped has
  to be able to say so. Kinds:
  - `{ "kind": "head" }` — the working tree, what `touched-files` means today;
  - `{ "kind": "since", "ref": "origin/main" }` — any revision the caller names;
  - `{ "kind": "pr", "number": "412" }` — a pull request by number or URL, the current
    branch's when `number` is absent.
- `changed` is added, modified, or renamed-with-edits: content this run has not seen.
  Root-relative, sorted.
- `renamed` is pure renames — git's `R100`, where every byte is accounted for. Kept apart
  because a **move is not a content change but it is a structural one**: a module that sat
  beside something may now sit above it.

## The matchers

Two pure functions, because there are two questions and a rule already has to say which it
means.

```
inScope(changeset, file)       // content: changed only
inGraphScope(changeset, file)  // content ∪ renamed
```

A content rule reads `inScope`: a pure rename has nothing new to say, its body was here
under another name. A rule that reads the import graph reads `inGraphScope`: the edges are
new even when the bytes are not. An absent changeset puts every file in both.

These are the semantics `joggle` proved out in its own `Scope` / `inScope` / `inGraphScope`;
lifting them here is the point, because the next engine with a graph should not re-derive
them.

## A third reader: the vocabulary diff

The change set has a consumer newer than this note: a **producer** comparing two snapshots of
its own artifact. `cutlist` measures a vocabulary at a revision, and the catalog committed at
the base is the other snapshot. Reading `changed` tells it which parts are new; only those
need to be compared against the existing ones. A new duplicate always has at least one changed
member, so the old graph is not re-judged.

This is the same measurement, not a second definition of "changed". The gate, the graph
engine, and the vocabulary diff answer "what is this run about?" with one set of bytes, which
is the reason the record exists. The diff itself — `catalog@base` against `catalog@head` —
belongs to `cutlist`; this record only says which revisions to load.

Scoping is not a gate on authoring. A run scoped to a change set is describing what a walk
introduced; it is not a rule about what may be built. The closed world is for references.

## The boundary

- **`jig` chooses the base and computes the record.** The knob — `gate.mode`, widened from
  `touched-files` to `head` / `since` / `pr` / `all` — stays in `jig`. Scope is policy, and
  policy does not live in this package (see the README's "What must never be in this
  package"). What crosses the boundary is the measurement, not the decision.
- **The gate filters on the record.** Universal, no engine change: a finding whose
  `location.file` is out of scope does not fail the run. This is what `touched-files` does
  today, with a base that can be something other than `HEAD`.
- **A graph-aware engine reads the record.** Filtering alone is wrong for a graph rule: a
  violation _created_ by a move lands on the moved file, which `changed` does not contain,
  and the gate would drop exactly the finding the move introduced. So `jig` writes the
  record and offers its path to engines that accept one; `joggle` reads it and runs its graph
  rules over `changed ∪ renamed`, while its content rules see `changed` alone.

Filtering is the floor; the record is what makes a graph engine correct.

## Requirements

- **An empty scope is loud.** The run says "nothing is in scope" the way it says an engine
  did not run, and a report that ran scoped carries the `base` it used.
- **Degrade to `all`, never to the empty set.** When git cannot answer — not a repository,
  no `gh`, a shallow clone with no common history — the scope is `all` with a note. The
  empty set is reserved for git's honest "nothing changed", and is never silent.
- **A scope filter is only as honest as each finding's location.** An engine that attributes
  a finding to a file that never changes — a config, a manifest — is filtered out of every
  scoped run. `cutlist`'s `stale-catalog` finding lands on `cutlist.config.json`, which a
  scoped run will not have touched. Engines whose findings are not tied to the file that
  caused them should say so, rather than be dropped in silence.

## Open

- **`--changed`: since the last run.** `joggle`'s other scope is stateful — measured against
  a stored run, not git — and no record here expresses it. It may be the same record with a
  `base` of `{ "kind": "stored" }`, or it may stay `joggle`'s alone.
- **The report's `scope`.** `report` should gain an optional `scope` — the change set a run
  ran against — so a scoped report is self-describing. Optional, so the evolution rule in
  the README is satisfied.
- **Submodules and generated trees.** `--relative` and `--exclude-standard` are the current
  answers; neither is specified here.
