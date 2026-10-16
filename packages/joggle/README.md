<div align="center">

# joggle

**Cross-file judgements for a TypeScript codebase, enforced like a linter.**

[![CI](https://github.com/autotelic/joggle/actions/workflows/joggle.yml/badge.svg)](https://github.com/autotelic/joggle/actions/workflows/joggle.yml)

</div>

> "I want to build the entropy reverser — a big sausage machine where you put all
> programs into it and you turn the handle and a smaller number of programs come
> out."
>
> — Joe Armstrong, *The Mess We're In*, 2014

`tsc` checks one program. `oxlint` checks one file. joggle checks the codebase: it
indexes it into facts, generates candidates cheaply and deterministically, and asks
**Jev** the narrow questions a single file cannot answer. Are these two
declarations one thing? Does this name mean the same here as there? Is this the
primitive that already exists?

Every finding proposes one of three moves, and the report groups by them:

| move | what it says |
| --- | --- |
| **contract** | a primitive already exists; this is a second copy. Delete it and use the primitive. |
| **combine** | the primitives exist; the combination was never written. A refactor. |
| **expand** | neither: the vocabulary has to grow. A name, a type, a boundary. A design act. |

The order is a ratchet, and the report prints it that way: **the copies hide the
primitives**, so contract first, composing makes them explicit, and a new primitive
is built out of the ones you can now see. A live repository *should* be full of
these, because each is a place the code ran ahead of its vocabulary. **The number
is not the product.** [Why, and the three moves](./docs/thesis.md).

## Jev

A judgement model, not a generator. It answers typed questions (yes or no, a choice
among named options, a spectrum) with calibrated probabilities, and code keeps the
thresholds: a decisive answer prints, an unsure one is recorded as a notice, a no is
silent. Arithmetic, counts, spans and orderings all stay in code.

Verdicts are cached per question in `.joggle/answers/`, one sharded file per key
prefix, so commit that directory and CI replays every judgement with no key and no
tokens. The shards are line-oriented and keyed, so a branch merge is a directory
merge, and `joggle cache prune` keeps them from growing without a ceiling. A yes/no is asked three times
and the **agreement** across the asks becomes its confidence, because one number on
its own has no margin. [How joggle uses TypeSafe](./docs/typesafe.md).

The evidence panel, including source excerpts, goes to `api.typesafe.ai`. Nothing
else does, and `--offline` sends nothing at all.

## Run it

```sh
pnpm install && pnpm build
npm link                             # puts `joggle` on PATH
joggle rules                         # what this repository enforces, by move
joggle check src                     # or no paths: tsgo says what the project is
TYPESAFE_API_KEY=… joggle check src  # the judged rules need the key
joggle check --offline               # replay the committed verdicts, no key
```

As a **pi extension** (`pi.extensions` → `./extensions`), so pi can run it in
whatever repository it is working in:

```sh
pi install /absolute/path/to/joggle  # global: adds the tools and the command
pi -e /absolute/path/to/joggle       # one run, no install
```

That adds `joggle_check`, `joggle_rules`, and `/joggle`.

## Docs

[thesis.md](./docs/thesis.md) what it is for ·
[writing-rules.md](./docs/writing-rules.md) write a rule ·
[rule-coupling.md](./docs/rule-coupling.md) the audit of every rule ·
[calibration.md](./docs/calibration.md) what the questions are worth ·
[JOGGLE.md](./JOGGLE.md) the architecture ·
[docs/](./docs/README.md) everything else.

MIT.
