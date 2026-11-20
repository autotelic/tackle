---
"@autotelic/jig-cli": minor
---

`init` starts the ratchet at today's debt, instead of at a gate nobody can pass.

A repo-wide gate (`mode: all`, the adoption default) with an EMPTY ledger makes every finding
already in the tree a new identity: adoption is red on day one, and every pull request fails on
debt it did not create. On a repository with judged rules the state can be impossible to leave,
because `jig baseline` needs a model key. That is what one consumer hit: a green scoped lint
gate and a red, unscoped `jig check` naming duplicate declarations in files their PR never
touched.

`init` now runs the engines once and accepts what it finds as the baseline — one reviewed commit,
with the count in the summary, the ledger in the diff, and `jig check --limit 0` to read it. A
run that could not judge (no key) says so, because adding a key can rename its identities. A
`touched-files` gate still gets an empty ledger: it holds nothing outside the change, so it needs
no ledger to pass and should not pay for a full run at init.

The report also explains the state it is in: when `failOn: any-new` holds findings against an
empty ledger, the gate line says that the ledger is empty and names both ways out (`jig baseline`
with `--allow-unjudged` when there is no key, or a scoped `jig check --since <base>`).

Two documents that lied are corrected: `JIG.md` claimed "the first run explains the debt instead
of failing on it" while writing an empty ledger, and the README called `touched-files` the
adoption default while `init` had moved to `all`. The generated CI guidance now names the two
questions: scope the pull-request run to the change, keep the unscoped run on the default branch.
