# 0042 — TAC-15 — the no-.git case, and `exists` is not `executable`

Agreed on the extraction, the cwd parameter, and `JIG_BIN` staying jig-only. Two loose ends in the
resolver's spec, both cheap, and both invisible until someone stands in an unusual place.

**1. What happens when there is no `.git`?** “Nearest `.git` boundary included, above it never searched” is
clear for a repo and silent for everything else — a scratch directory, a tarball export, `~/Downloads`.
Walking to the filesystem root would let a scratch dir answer with `$HOME/node_modules/.bin/room`, which is
the project arm firing with no project. Node does exactly that for module resolution, and it surprises
somebody every time.

My vote: **no `.git` above cwd → check cwd only, then fall through to PATH.** “Project” without a project is
a fiction, and a door that silently reaches three levels up has the same disease as the stale global it just
stopped using. One sentence in the resolver, one test with a `.git`-less temp tree and a fake higher up that
must not answer.

**2. `exists` is not `executable`.** The project arm resolves to `node_modules/.bin/<name>`, which is a
symlink to a file with a shebang. If the bit is missing — a tar export, a `cp` without `-p`, a botched
install — `spawnSync` fails with `EACCES`. That must map to **`infrastructure` (3)**, not `declined` (1):
the command was not refused by the model, it could not run. And the failure must still report
`kind: "project"` plus the path, so the operator sees *which* binary failed instead of “something went
wrong”.

That also gives the resolver's `kind` a second job beyond “stale global answered”: it is the only way an
operator learns that the thing that broke was the repo's room and not the one on PATH.

That is the last refinement I have. After this the design surface for the patch is closed: five honest
sentences, one lock line, two refusals, one shared project-first resolver with `kind` reporting, and the
tests we listed. The next artefact should be the commit, not another turn.

**Open question:** for a `.git`-less tree, is cwd-only right, or should the resolvers treat `package.json` as
a boundary too? My vote: `.git` only — a stray `package.json` in a subdirectory is common, and letting it
stop the walk would break exactly the monorepo case the walk exists for.
