# The artifacts: what is committed, what is cached, and why

joggle writes four things. They have four different owners, and the mistake this
document exists to stop is treating them as one. The rule underneath every
decision here:

> Never merge a cache. Regenerate it. Commit only what a person wrote or
> accepted, and shard it so that a merge is impossible in the first place.

This is not an original observation. It is what the rest of the ecosystem
already does, and this document names the exemplar each choice is modelled on so
the reasoning can be checked rather than taken on faith.

## The four artifacts

| artifact | lives in | committed | nature | model |
| --- | --- | --- | --- | --- |
| `answers/` — one answered question, keyed by question + atoms + model | `<root>/.joggle/` or the machine cache | opt-in | disposable, grows, mostly negatives | **Bazel action cache / sccache**: sharded, content-addressed, with GC |
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

The replacement is content-addressed and sharded, because the key already is:
`answerKeyFor` hashes the decision, the atoms it read, the model and the
decision version. The file an answer lands in is therefore a function of the
answer's identity alone.

```
.joggle/answers/7b.jsonl      # every key beginning 7b
.joggle/answers/a0.jsonl
...
```

Each line is one entry: the key, when it was written, and the stored answer.

```
7b3ff63e79c04054	1712345678	{"confidence":0.88,"kind":"Classify",...}
```

Three properties follow, and each is a problem the old file had:

- **A new entry cannot conflict.** Two branches add different lines. Different
  shards, different files; same shard, usually different lines.
- **An entry can be pruned.** `joggle cache prune` reads the timestamp, drops
  what is old or over a size ceiling, and rewrites only the affected shards.
- **A diff is the change.** Lines are sorted by key, so a replay with no new
  answers is a no-op in git rather than a reordering.

This is Bazel's shape: sharded content-addressed storage, deterministic so a
diff means a change, and a merge driver for the residual collision.

### The residual collision, and the driver

Sorting makes a conflict rare, not impossible: two branches can still insert
adjacent lines in the same shard. For that case joggle ships a merge driver,
exactly as Bazel ships `bazel-lockfile-merge` for `MODULE.bazel.lock`:

```gitattributes
answers/*.jsonl merge=joggle-answers
```

Registered once per machine:

```sh
git config merge.joggle-answers.name "joggle answer cache"
git config merge.joggle-answers.driver "joggle merge-answers %O %A %B"
```

The driver reads the three shard versions, unions them by key (the newer
timestamp wins a genuine disagreement, which cannot happen for a
content-addressed key unless the model answered twice), sorts, and writes the
result. A driver that cannot parse a non-empty side exits non-zero and lets git
fall back to a normal conflict instead of silently dropping data.

joggle writes these attributes into `.joggle/.gitattributes` itself, so a
repository that opts into committing the cache gets the hiding and the merge
driver without having to know they exist.

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
  service. The sharded cache is committed, the merge driver is registered, and
  `cache prune` keeps it from growing without a ceiling. joggle's own repository
  is in this mode.

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
