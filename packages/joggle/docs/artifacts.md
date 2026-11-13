# The artifacts: what is committed, what is cached, and why

joggle writes four things. They have four different owners, and the mistake this
document exists to stop is treating them as one. The rule underneath every
decision here:

> Never merge a cache. Regenerate it. Commit only what a person wrote or
> accepted, in lines that merge: one answer per line, sorted by key.

This is not an original observation. It is what the rest of the ecosystem
already does, and this document names the exemplar each choice is modelled on so
the reasoning can be checked rather than taken on faith.

## The four artifacts

| artifact | lives in | committed | nature | model |
| --- | --- | --- | --- | --- |
| `answers.jsonl` (or `answers/` when sharded) — one answered question, keyed by question + atoms + model | `<root>/.joggle/` or the machine cache | opt-in | disposable, grows, mostly negatives | **Bazel action cache / sccache**: content-addressed, with GC; sharded only when size earns it |
| `baseline/` — the findings a person accepted | `<root>/.joggle/` | **yes** | durable, human-authored, per-PR | **changesets / towncrier**: one fragment per entry |
| `wire.json` — a whole wire request's response | machine cache | no | pure performance artifact | **Nix's hidden lockfile**: machine-local, deletable |
| `last-run.json` — the manifest and the last report | machine cache | no | pure performance artifact | **Nix's hidden lockfile**: machine-local, deletable |

## Why the answer cache is shaped the way it is

The old shape was one `answers.json`: a pretty-printed object with one key per
question. It works at small scale and fails everywhere else:

- **It cannot be merged.** Two branches that judge different candidates both
  edit the same object, and git resolves that as whole-file line soup. There is
  no correct manual resolution, because the union of two answer sets is not a
  textual operation on pretty-printed JSON.
- **It cannot be pruned.** A single object has no per-entry lifetime, so the
  only GC is `rm`, which throws away every reviewed verdict with the garbage.
- **It grows monotonically.** The cache has to store the negatives too, and on a
  2,500-file repository that is tens of thousands of entries.

The replacement is content-addressed and line-oriented, because the key already
is: `answerKeyFor` hashes the decision, the atoms it read, the model and the
decision version, so one line names one answer.

Two layouts, one format:

- **single** (the default) — `.joggle/answers.jsonl`, sorted by key. This is the
  shape a reviewer reads: a verdict change is one line in one diff. It is right
  up to a few thousand entries.
- **sharded** — `.joggle/answers/<first two hex chars>.jsonl`, chosen explicitly
  (`cache.layout: "sharded"`, or `joggle cache migrate --layout sharded`) when a
  whole-file rewrite or a merge is a real cost. Sharding 182 entries into 130
  files was the mistake this default corrects: it traded reviewability for merge
  granularity, and git cannot ship the driver that was supposed to make it safe.

Both are read, and `joggle cache migrate --layout` moves between them. The older
`answers.json` object is read and consolidated into the single file on the first
write.

Each line is one entry: the key, when it was written, and the stored answer.

```
7b3ff63e79c04054	1712345678	{"confidence":0.88,"kind":"Classify",...}
```

Three properties follow, and each is a problem the old file had:

- **A new entry cannot conflict.** Two branches add different lines, and
  `merge=union` keeps both. A verdict that changes is one line replaced.
- **An entry can be pruned.** `joggle cache prune` reads the timestamp, drops
  what is old or over a size ceiling, and rewrites only the affected file.
- **A diff is the change.** Lines are sorted by key, so a replay with no new
  answers is a no-op in git rather than a reordering.

This is Bazel's shape where it earns it: content-addressed and deterministic so
a diff means a change. Sharding is the opt-in for size, not the default.

### The residual collision, and the driver

Sorting makes a conflict rare, not impossible: two branches can still insert
adjacent lines in the same shard. Both layouts use git's built-in `merge=union`, which needs
no setup and keeps both sides' lines:

```gitattributes
answers.jsonl merge=union
answers/*.jsonl merge=union
```

Union is correct here because the file is append-only and keyed: two branches
add different keys, and a key's content is what its hash addresses. A
same-key/different-content collision cannot happen unless the model answered the
same question twice.

joggle also ships `joggle merge-answers` for repositories that want a
newer-timestamp-wins dedupe. Git cannot ship a merge driver in a
`.gitattributes` file, so using it means registering it once per machine:

```sh
git config merge.joggle-answers.name "joggle answer cache"
git config merge.joggle-answers.driver "joggle merge-answers %O %A %B"
```

The driver reads the three shard versions, unions them by key (the newer
timestamp wins a genuine disagreement), sorts, and writes the result. A driver
that cannot parse a non-empty side exits non-zero and lets git fall back to a
normal conflict instead of silently dropping data.

**The committed shape does not depend on that driver**, because a fresh clone...
would not have it. joggle writes the union attributes into
`.joggle/.gitattributes` itself, and rewrites the older custom-driver banner in
place so an existing repository migrates on its next write.

### Reviewing the ledger

No `-diff` and no `linguist-generated`: the ledger is the artifact a maintainer
is supposed to have read, and those attributes made it a collapsed binary blob.
A verdict change is one visible line. `joggle cache report` renders what the
store holds without replaying it -- entry and file counts, layout, verdict
distribution, labels, and the date range -- so a reviewer has a summary beside
the diff. The summary is not the artifact: it cannot be replayed.

## Why the baseline is fragments

A baseline entry is "a person looked at this finding and accepted it". It is the
one thing here worth committing, and it is the thing that collides most often,
because every branch that fixes or adds a finding wants to change it.

The answer is the one the changelog tools arrived at years ago (changesets,
towncrier, scriv, changie): **one new file per entry**. A new file cannot
conflict; a directory merge is no merge.

```
.joggle/baseline/<identity-hash>.json     # one accepted finding
```

The identity is already stable and line-independent (`rule + kept symbol +
cluster membership`), so a fragment names a finding, not a location. Accepting
`--update-baseline` writes fragments; `--baseline` reads the directory. Removing
an acceptance deletes a file.

## The deployment modes

The old design had one default and it was tuned on joggle's own repository. The
three real deployments have different constraints, and joggle now names them:

- **local** — a developer or an agent checking a repository it does not own.
  The answer cache and the wire cache are machine-local (`$XDG_CACHE_HOME`);
  nothing is written into the checkout. This is the default: a run uses
  `<cwd>/.joggle` only when that directory already exists (a repository being
  onboarded, whose cache is a committed artifact) and the machine cache
  otherwise. Explicit `--cache-dir` always wins, so onboarding is
  `joggle check --cache-dir .joggle` once, then the directory exists and every
  later run finds it.
- **ci** — keyless replay. The answer cache is persisted through the CI cache
  service (`actions/cache`), keyed on the lockfile and the decision version. A
  cold cache degrades to deterministic rules plus baseline, which is what a
  missing key already means.
- **committed** — a repository that wants keyless replay without a cache
  service. `answers.jsonl` is committed (sharded explicitly only when the store
  is large enough to need it), and `cache prune` keeps it from growing without a
  ceiling. joggle's own repository is in this mode.

## What is deliberately not done

- **The answer cache is not moved into a git ref.** `git notes` with its
  `cat_sort_uniq` strategy is the one mechanism that stores machine metadata
  entirely outside the tree, and it is the correct shape for a per-commit cache.
  It is not used here because joggle's entries are keyed on a question and its
  atoms, not on a commit, and because refs are not fetched by default in CI or
  shown in a pull request — which would trade a merge problem for a
  discoverability one. It remains the fallback if the committed mode proves
  insufficient.
- **The wire cache is not committed.** It is keyed on a whole request, so it
  changes whenever any question in it changes, and on a 2,493-file repository it
  reached 11.5 megabytes. It is a performance artifact and it stays on the
  machine.
