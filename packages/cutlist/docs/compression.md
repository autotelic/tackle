# The compression loop

**Status: design note.** This records how the vocabulary grows and how it is collected. It
is the process half of [artifact.md](./artifact.md): that file is the shape of the artifact,
this one is what the artifact is for. Nothing here is implemented.

## The sentence

The catalog is a heap. A walk allocates freely. A duplicate is garbage. `joggle` is the
marking phase and compression is compaction. A collector that optimizes by discouraging
allocation has misunderstood its job.

## The walk is not a violation

`joggle`'s thesis splits development in two: exploration pushes the frontier and the mess is
the record of what was learned; reversal asks whether the thing can be rebuilt from the
primitives that now exist. Compression is the reversal half, and it cannot run without the
exploration half having produced something to reverse.

So implementation is expected to walk unconstrained. It reads the menu, or it does not. It
builds what the problem seems to need, and sometimes that is a thing the repository already
has. That is not a defect to prevent; it is **evidence**, and it has two readings:

- the existing part did not fit, so the new shape is truer — promote it and retire the old;
- the existing part did fit, so the copy is redundant — contract it.

Both are wins. The only failure is **not noticing**, which is a measurement problem, not an
authoring one. The tool's job is to make the copy cheap to see and cheap to collapse, not to
stop it being written.

This is the same shape as the crossword archive that motivated the format discussion: a
complete, uniform, comparison-friendly record of everything, which left the writing
completely free. A format that is also a style guide would have found nothing.

## The loop

Collection belongs at a boundary — after a feature, a branch, a merge — not in the middle of
thinking, for the same reason a GC does not stop the world on every allocation.

1. **Walk.** Branch or worktree, no gate. The menu is a prior, not a fence.
2. **Measure at the boundary.** `cutlist build` at head. The catalog committed at the base
   revision is the other snapshot; git is the snapshot store.
3. **Diff the vocabularies.** New parts, changed parts, gone parts. Candidates are
   **new × old**, plus new × new. A new duplicate always has at least one changed member, so
   nothing else can have created it and the old graph is not re-judged. This is `joggle`'s
   own scope rule, lifted from [the change set](../../protocol/docs/scoping.md) rather than
   re-derived.
4. **Judge with both sides' evidence.** The candidate carries the difference, not only the
   score: the signature delta (what the new one adds and drops), the tier, the owners, the
   spread, the import count. Ask the one question the catalog cannot answer — _are these one
   concept?_ — and then the one this loop adds: _which one survives?_
5. **Apply and record.** `contract`, `promote`, `combine`, or `keep_variants`; one fragment
   per accepted compression, the way a baseline entry is one file. The stable id is the
   citation.
6. **Re-measure.** The catalog now contains the new vocabulary. Silence is a result: if the
   walk produced something genuinely novel, nothing fires, and that is the vocabulary
   growing rather than a miss.

## Which one survives

This is the question the existing questionnaire cannot ask. `joggle` decides whether two
things are one (verdict: `collapse`, `keep_variants`, `no_issue`) and what to do
(prescription: `merge`, `move`, `split`, `share_a_contract`, `leave_it`). A walk adds the
case where the **new** thing is the better one. Four moves, and where each lands in the
report's vocabulary:

| Move            | Maps to the report                              | When                                                             | Consequence                       |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| `contract`      | `collapse` + `merge`                            | the incumbent survives; the copy is redundant                    | delete the copy, repoint imports  |
| `promote`       | `collapse`, with the new member as the survivor | the new shape supersedes the incumbent                           | move the primitive, migrate users |
| `combine`       | `split` or `move`                               | neither is the primitive; the combination is the thing to write  | write it, then contract           |
| `keep_variants` | `keep_variants` + `share_a_contract`/`leave_it` | a boundary makes sharing wrong (deployables, framework-required) | leave both, record why            |

`promote` is the reason the walk pays, and it is the one case where "duplicate" is not the
right word. It is not `merge`: `merge` keeps the incumbent, `promote` is `merge` with the
survivor chosen by the evidence and a migration order attached. The _classification_ — is
the new shape truer? — is a meaning question and belongs to the model, with the evidence
above in its state. The _consequences_ are facts and belong to code: how many importers
move, in what order (leaves first, or most-imported first). That is the two-regime line
applied to compression, not a new regime.

## Evidence from a real walk

One measurement, not a baseline: `shakti-v2` at `965a1a07` (a mid-rebase snapshot) on
2026-10-20, measured in a detached worktree so the live checkout was untouched. Config:
`roots: services/ui/app`, `~/*` and `@shared/*`, tiers `components/ui` / `components` /
`routes`. The tool wrote 857 files in 2.8 s.

| Measurement                 |                       Result |
| --------------------------- | ---------------------------: |
| Modules in the inventory    |                        1,278 |
| Distinct names              |                          962 |
| Names used more than once   |        56 names, 316 modules |
| Render no tag               |                          509 |
| Empty signature             |                          422 |
| Undocumented                |                    933 (73%) |
| Duplicate candidates        |                          362 |
| Candidates scoring 1.0      |                          131 |
| Candidates with a tiny side |                          173 |
| Orphans                     |                           37 |
| Connected components        |                           49 |
| The artifact                |            857 files, 9.7 MB |
| Tokens                      | 27 colors, 0 type, 0 spacing |

What the numbers say:

- **Identity by name fails.** 962 distinct names for 1,278 modules; 316 share a name with
  another (`schema` ×67, `types` ×59, `utils` ×53). A rebuilt part cannot be told from a
  rename, which is the whole input of the diff.
- **A third of the inventory is not a part.** 509 modules render no tag; 422 have an empty
  signature; 367 of the no-tag modules are route files. The menu is the right place for
  them, but not as _components_.
- **The candidate mass is trivial.** Of 362 candidates, 131 score exactly 1.0 and 173 have a
  side with signature ≤ 2. A `<span>` wrapper is not a duplicate, it is an unnamed
  primitive — a different move.
- **The pair graph is not a partition.** 49 connected components, 8 with ≥5 members. The
  largest is a **chain**, not a family: `Tooltip.tsx`, `useTableState.ts` and
  `ProjectMapboxMap.tsx` in one component. Pair-wise Jaccard at the then-0.6 threshold is a
  graph; the cluster is what gets judged. (The current threshold is 0.7 and the join drops
  React's own hooks first, so this measurement is a historical baseline.)
- **The context family is `expand`.** 21 members, every one `context.ts`/`context.tsx`, all
  tiny. Not 21 copies of one thing: one unnamed pattern repeated 21 times.
- **The combobox family is the case.** 15 files match `*combobox*` outside tests (including
  one hook), one of them spelled `ComboxBox`, and the candidate graph groups ten. None is
  the shared primitive. This is the `contract`/`promote` case, and it is why a walk is worth
  measuring.
- **The rendering is expensive.** 857 files, 9.7 MB: 425 diagram panels, `catalog.json`
  901 KB, `menu.json` 488 KB, `plumb-ui.config.json` 784 KB, `MENU.md` 250 KB / 1,375 lines.
- **The tokens are partly noise.** 27 colors including `DEFAULT`, `alpha`, `beta`; 0 type
  and 0 spacing, because the Tailwind key scan misses `fontFamily`/`fontWeight`.
- **Determinism is the precondition.** The same tree through `--cwd /var/…` and through
  `process.cwd()` (`/private/var/…`) gave `e5e14a63…` and `2b081cab…`, because
  `catalog.root` is absolute and inside the hash. `jig check` reported a catalog it had
  just built as stale. Until two measurements of one tree agree, a snapshot diff is noise
  and the loop cannot close.

## What the artifact must carry

Most of this is artifact.md's list; the loop is what makes each item load-bearing.

- **A stable id.** Without it, "rebuilt X" is indistinguishable from "renamed X" and
  "deleted X, added Y". The diff needs identity. This is now the linchpin for compression,
  not only for the atlas.
- **A snapshot and a diff.** `catalog@base` and `catalog@head`, compared by id, not by
  position. The diff is an operation over the artifact, not a second definition of "changed".
- **A candidate with both sides and the delta.** The score alone cannot answer "which
  survives"; the signature delta and the spread can help the model answer it.
- **A kind and a signature floor.** A context, a hook, and a combobox must not enter the same
  instrument. The floor is `minTokens`'s lesson from `joggle`: a one-element signature is
  evidence of a wrapper, not of a duplicate concept.
- **Fragments for accepted compressions.** One file per accepted cut, the baseline pattern:
  it cannot conflict, it is citable, and it is the ratchet.
- **A consumer.** `catalog.json` is decoded by `protocol`'s conformance tests and projected into the menu and the manifest that `plumb-ui` reads; `jig` runs the producer's staleness gate. What is still missing is a **joggle** rule that reads the duplicate candidates and clusters, so cutlist's deterministic half can aim the judged half. Until then, cutlist produces a navigable diagram of the vocabulary rather than a force on it.

## What would make this bad

- **A pre-work gate.** Requiring the menu to be consulted before authoring stops the
  exploration half and turns the derived catalog into a curated one by another route.
- **Judging the whole graph every run.** A collection that re-examines all 362 old pairs
  cannot be run at a boundary; the change set is what makes it affordable.
- **A heuristic for "which survives".** If it has a threshold, it is a person's taste wearing
  the costume of a fact. Put the evidence in the state and ask.
- **Optimizing for zero.** The number is not the product; the move is. A live repository
  should be full of these.
- **Treating silence as a miss.** A genuinely new primitive that matches nothing is the
  vocabulary growing. Manufacturing a finding to look useful is the failure.
- **Collecting during the walk.** Stopping the world at every allocation is how exploration
  gets discouraged.

## Open

- **Promote's tie-break.** What makes a new shape truer — fewer props, a superset of
  behaviors, more owners, the primitive tier? The evidence is a list; the decision is a
  question.
- **The cadence.** Per branch, per merge, or per release? The baseline ratchet suggests the
  merge boundary, but a long branch may need one collection before it lands.
- **The gap record.** A walk that found nothing suitable is a demand signal. Is it a fragment
  (`gaps/<id-or-slug>.json`) with the intended use, closed when the part lands? It is the
  same shape as an accepted finding, with the opposite meaning.
- **Renames.** A pure rename must not read as new + deleted. `protocol`'s change set already
  keeps `renamed` apart for the graph; the catalog diff needs the same distinction.
- **Several apps.** The `workspace` dimension changes what "one concept" means: a Button in
  two deployables is `keep_variants`, not a duplicate. The judge needs the boundary in its
  state, as `duplicate-implementation` already learned.
