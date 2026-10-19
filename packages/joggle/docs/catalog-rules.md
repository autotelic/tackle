# Rules pointed at the catalog

joggle's rules read one thing: `Workspace`, the deterministic index of the AST. Every fact a
rule sees — `callSites`, `jsx`, `objects`, `columns`, and the `units` with their `fields`,
`composed`, `calls` — is syntax the parser found, and the rule refuses to say what it means.
That refusal is the ethos the rest of the tool rests on: **record facts, generate candidates,
ask the model for the verdict** (`writing-rules.md`, `two-regimes.md`).

`cutlist` reads the same AST and does the thing joggle deliberately does not: it *interprets*
it into a UI shape — a component's `tier`, its `owners`, its `props` and `tags`, and a
`signature` that names the tags it renders, the hooks it calls, and the headless packages it
uses. That interpretation is committed as `catalog.json`, and projected for linters as
`manifest.json`.

The proposal: a rule may take shapes from **two** sources — the AST, as today, and the
catalog, when the repository uses cutlist — and the catalog crosses the boundary as a decoded
record, never as an import. `joggle` and `plumb` both gain; neither is allowed to depend on
`cutlist`.

## The catalog is a different kind of input

It is not one more fact. A fact is what the parser saw; the catalog is what another tool
*concluded*, from a config — tiers, shared roots, tokens — that is the repository's own
opinion. Three consequences follow, and each is a rule an author has to obey.

- **Coarse.** The signature is a set of strings (`tag:button`, `hook:useState`,
  `uses:@radix-ui/react-dialog`). No order, no spans, no types. The AST is finer.
- **Committed, so it can drift.** A catalog is regenerated, not live; between regeneration and
  now the code moved. `cutlist --check` compares a content hash — it says *that* the catalog
  is stale, never *what* changed.
- **Optional.** A repository that does not use cutlist has no catalog. A rule that requires one
  only runs for some repositories, and must say so rather than go quiet.

The union is what is more correct than either alone. The AST knows the order of the hooks, the
prop spreads, the nesting depth. The catalog knows a `Button` from a `div` button, which tier a
component belongs to, and which two components are the same concept.

## The split: deterministic to plumb, judged to joggle

`writing-rules.md` already draws the line — a deterministic predicate belongs in a linter, and
joggle is the judged layer. The catalog splits the same way, and that is why this is a
question about *both* rulebooks.

- **plumb** — single-file, deterministic, no model. Read the manifest and check a claim
  against the file: the tier a component declares against what it imports, a headless package
  it claims to use against what it renders, a signature that no longer matches the body.
  `@autotelic/plumb/ui` is exactly this rulebook; the manifest's whole purpose is to feed it,
  and it lives on the branch this workspace did not take.
- **joggle** — cross-file, judged. Take catalog-derived candidates and ask the question the
  catalog cannot answer: are these two components one thing, does this page's state belong in
  a provider, is this hook a primitive that already exists.

Both read the same bytes through `@autotelic/protocol`'s decoders. Neither imports cutlist.

## What each host gains

For plumb, the catalog turns a name convention into a fact. Today a UI rule guesses "is this a
primitive?" from a directory; the manifest tells it, and the guess is gone.

For joggle, three rules the AST alone cannot write:

- **`duplicate-implementation`, for components.** cutlist already computes Jaccard-on-skeleton
  duplicate candidates and — in its own type, `DuplicateCandidate` — asks *a judge to confirm
  them*. joggle is that judge. The deterministic half is cutlist's; the verdict is joggle's.
  This is `two-regimes.md` applied across two tools, and it produces the thing the catalog
  cannot: a decision that two components are one.
- **`name-the-primitive`, for hooks.** The type-level rule mines groups of fields. The UI
  analogue mines groups of `(props ∪ tags ∪ hooks ∪ uses)` repeated across components with no
  name of their own. The catalog supplies the parts, so the group is a group of *things*, not a
  group of strings.
- **`page-needs-composition`, grounded.** Today it counts `useState` call sites and detects a
  provider by the `.Provider` suffix on a JSX element. With the catalog it reads the composition
  graph — which component renders which, which hooks are called — so the trigger is the real
  shape and not a name match.

## What the protocol owes

The decoders exist (`decodeCatalog`, `decodeManifest`) and so do the pure helpers a rule wants
(`signatureOf`, `similarityOf`, `nearestDuplicate`, `projectManifest`, `composedOf`,
`emptyCatalog`). What is missing is the **signature grammar**. `signature` is an
`array of string` with a prose description, and its prefixes — `tag:`, `hook:`, `uses:` — are a
convention no schema declares. A rule that wants `hooksOf(component)` has to parse prefixes, and
a second consumer that parses them differently is the drift this workspace exists to prevent.

So: declare the prefixes, and export the splitter beside the decoder. It is a pure function over
an existing record, so it belongs here and not in cutlist.

## The guardrails

- **Absence is not clean.** No catalog means a note ("cutlist is not configured"), never a
  finding and never silence — the same discipline as `plumb-ui` failing open and
  `cutlist --check` being loud about a stale catalog.
- **A rule that reports the catalog as ground truth reports the generator.** The catalog is
  another tool's conclusion. A rule must be able to say the catalog disagrees with the code,
  which is why the deterministic drift check comes before the judged questions: judging shapes
  from a catalog you have not verified is judging the generator.
- **Architecture stays a preset.** Tiers and ownership are the repository's opinions, and
  `rules/index.ts` already refuses to run one repository's architecture by default.
- **joggle never imports cutlist.** The record and its decoders are the whole interface.

## Open

- **One record, resolved once.** If plumb and joggle both read the catalog, `jig` should resolve
  the path once and hand it to both, the way it can hand a change set (`protocol`'s
  `docs/scoping.md`) — so a host's rule and CI's rule read the same bytes.
- **Blocks and pages.** cutlist ranks tiers; it does not model a composition bundle's blocks.
  joggle's composition preset does. Which one owns that shape is not decided here.
- **The catalog comment and the code disagree.** `catalog.ts` describes the signature as also
  carrying "token-class categories"; `skeletonOf` emits `tag:`, `hook:`, `uses:` and nothing
  else. The grammar has to be pinned before a second reader trusts it.
