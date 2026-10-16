# What joggle is for

> "I want to build the entropy reverser — a big sausage machine where you put all
> programs into it and you turn the handle and a smaller number of programs come
> out."
>
> — Joe Armstrong, *The Mess We're In*, 2014

There are two halves to developing software, and they want opposite things.

The first half is **exploration**. You push the frontier of the design space out
into the world, you try things, you hack things together to learn what the
problem actually is. Entropy is the point: the mess is the record of everything
you learned. A tool that demands a tidy codebase during this half is a tool that
stops the exploring.

The second half is **reversal**. Now that you have built something, you look at
it and ask one question: *can I rebuild this out of the primitives I already
have?*

joggle is the second half. It is not there to make the codebase small or quiet or
green. A live repository should be full of the things it finds — each one is a
place where the code ran ahead of its vocabulary, which is exactly what pressing
the frontier out produces. The number is not the product. The **move** is.

## When the answer is no

You try to rebuild the thing from your primitives and you cannot. Then it is one
of three things, and they are not interchangeable:

- **contract** — a primitive already exists; this is a second copy of it. Delete
  the copy and use the primitive. This is cleanup: cheap, safe, mechanical.
- **combine** — the primitives exist and the combination was never written. The
  thing is real; it just is not stated as `part & { … }` or as a call to the
  helper that already does the shared part. This is a refactor.
- **expand** — neither. The model is wrong, and the vocabulary has to grow: a name
  for a concept nobody named, a type that carries an invariant instead of being
  re-checked, a boundary that is in the wrong place. This is a **design act**, and
  in the framing this comes from it is the one that is not yours to make alone:
  "we are introducing a new pattern, and that is a change request."

`contract` is the leaves. `combine` is the next branch. `expand` is the growth.
The order matters, because the copies hide the primitives: nothing is legible
until the duplicates are gone, nothing can be composed until the primitives are
legible, and a new primitive has to be built out of the ones you can now see.

## How joggle says it

Every rule declares the move it proposes, and every finding carries it. The
report groups by move, in the ratchet order, and a finding with no move is one
that checks the code against a requirement (a cycle, a layering, a 404) rather
than proposing a reversal — those are the requirements, not the entropy.

| move | rules |
| --- | --- |
| contract | `duplicate-implementation`, `duplicate-meaning`, `reimplemented-primitive`, `naming-drift`, `one-concept-one-type`, `call-pattern`, `duplicate-call-run` |
| combine | `compose-types` (the compose advice) |
| expand | `compose-types` (a name declared twice), `name-the-primitive`, `object-shape`, `types-over-logic`, `field-type-drift`, `nullability-drift`, `language-drift`, `hoist-to-domain`, `shallow-module`, `name-as-address`, `page-needs-composition` |
| — | `import-cycle`, `layer-direction`, `layer-purity`, `dependency-fit`, `module-direction`, `temporal-coupling`, `data-error-as-outage`, `doc-matches-code`, `rule-judgment`, the bundle rules |

One rule can carry two moves: `compose-types` reports `combine` when the whole is
genuinely the part plus more, and `expand` when one name has come to mean two
things. The move is on the finding for this reason, not only on the rule.

A move is a band, not a severity. A 104-file `expand` and a two-file `contract`
are both real; they are just different kinds of work. Severity says how urgent a
finding is; the move says what kind of thing it is asking for.

## What this is not

This is not a mandate to get the report to zero. "This project does not compile
to the spec of an Autotelic project" is the wrong question — it treats every
finding as a defect, and turns a live codebase's record of exploration into a
failure. The right question is the one above: *which of the three is this, and
what does it tell me to do next?* The ratchet tightens when you are ready; the
report stays full on purpose.

The deeper version of this — the harness, the patterns, the feedback loop from an
assessment back into "this is a new rule" — is in
[`reference/something.md`](./reference/something.md). The measurements behind the
rules are in [`calibration.md`](./calibration.md).
