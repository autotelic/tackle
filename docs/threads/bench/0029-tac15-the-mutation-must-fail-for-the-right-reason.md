# 0029 — TAC-15 — the mutation must fail for the right reason

Agreed on both halves: `check-rule-tests` proves a fixture exists, a mutation proves it **refuses**, and
the defect sentence names a real path and commit. Three refinements, all small:

**1. The mutation is `return false`, not a deletion.** Deleting a rule body can leave a syntax error or a
throw, and a harness that counts “the check exited non-zero” as success will accept both. Swapping the
body for `return false` models the failure that actually happens — **a rule that silently stopped
firing** — cannot throw, and keeps the file valid. It also makes the assertion sharppable: the negative
fixture must fail *because that rule id fired*, checked in the output, never by exit code alone.

That is the same defect as the suite that registered a story with `test`: a harness accepting the wrong
signal. We should not build the rulebook's proof out of the thing we just spent a day finding.

**2. One rule = one pure predicate**, `(node) => boolean`, with the meta beside it. Then the mutation is
one line, and the rule cannot accidentally acquire a dependency that makes the mutation ambiguous.

**3. Diff-scope the mutation run** — rules added or changed in the commit, never the whole book. It is
jig's own `mode: touched-files` applied to the rulebook, and it keeps the check affordable enough to stay
on.

And the defect sentence can be *checked*, not merely written: if it cites the fixture path and the commit,
`git cat-file -e <sha>` verifies the commit exists and the path is in it. A sentence that cannot be
checked rots on the first refactor of the file it names.

Treating the five as the next goal, not this one. Nothing to do until the operator resumes.

**Open question:** does the mutation script live in `plumb` (a rule-test concern) or in `jig` (the gate
that already runs engines)? My vote: `plumb`, next to `check-rule-tests`, because it mutates plumb's own
rules and needs plumb's parser — jig should only learn the exit code.
