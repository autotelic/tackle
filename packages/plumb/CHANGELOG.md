# @autotelic/plumb

## 0.7.2

### Patch Changes

- `guarded-op-must-return-option` and `guarded-op-must-return-effect` no longer contradict.

  The first recommended `Option` from a `T | undefined` return; the second rejected `Option` for
  hiding the reason and demanded `Either<T, TaggedReason>`. There was no spelling that satisfied
  both, and it cost five files and five passes in one repository before a module named
  `absence.ts` was written to answer the question once.

  The option rule now recommends `Either<T, TaggedReason>` — the shape the effect rule already
  accepts — and keeps its id, so consumer configs do not shift. Both rules build their messages from
  one vocabulary in `effect/absence-shape.ts`, and `absence-shape-matrix.test.ts` proves the three
  return shapes through both rules with only `Either` passing.

  The sibling pair is settled the same way in its messages: a **required** parameter spelled
  `T | undefined` is the satisfiable form of `no-optional-function-parameters` against
  `no-duplicate-type-constituents`.

## 0.7.1

### Patch Changes

- `no-shape-in-symbol-names` fires at declaration sites, not on every identifier.

  It flagged any identifier containing "shape", including a member read
  (`unit.shape`) and an import of someone else's export. Neither is a name this
  package chose, and the only way to satisfy the rule was to spell the read
  `unit["shape"]` — strictly worse code, which is what an unfixable finding
  produces. The rule now narrows by node type at the places a name is introduced
  (variables, functions, classes, interfaces, type aliases, enums, and member
  signatures), which also removes the need for a parent pointer the rule API does
  not provide.

## 0.7.0

### Minor Changes

- d79f804: `plumb-effect/no-run-promise-outside-seam` is the seam rule the Effect rulebook was missing. An
  Effect is a description, and `runPromise` is where one becomes a running process; every extra call
  site is a second entry point with its own failure policy and its own test seam. The rule fires on
  `Effect.runPromise` (and the namespace and named-import aliases of it) in every file the
  application does not name in its `seams` option, so a handler that runs its own effect is a finding
  instead of a convention in a comment.

  Which defect it catches: a permissions workstream ran handler effects with `Effect.runPromise` in
  the route module, so three failure policies lived in one file, the route could not be tested at its
  seam, and the user had to ask for the seam twice. Test files are skipped: a test owns its runtime.

- 0a4b914: `plumb-ui` gains `no-off-token-color`, and both catalog rules now resolve the manifest per file — the only place oxlint gives a rule its options.

  **`no-off-token-color`** is the second catalog rule: every color in a file must name a member of the manifest's declared color set, the closed set cutlist extracts into `colors`. It reports off-palette classes (`text-red-500` when `red` was never declared), hard-coded values (`bg-[#334e68]`, `border-[rgb(…)]`), undeclared variables (`bg-(--brand)`), SVG paint literals (`<svg fill="#334e68">`), and inline style colors (`style={{ color: "#fff" }}`). Non-color readings of shared prefixes are excluded (`text-sm` is a size, `border-2` a width, `divide-x` an axis), keywords pass (`bg-transparent`), and a declared scale root covers its shades (`red-500` passes when `red` is declared — the manifest's flat keys cannot judge shade completeness). It fails open when the manifest is missing, malformed, or carries no `colors`.

  **Options are per-file in oxlint.** `createOnce` runs at plugin registration, when `context.options` is still `null`; the configured options exist only in `before()` and the visitors. Both catalog rules read the manifest at createOnce and so returned `{}` in every real run — green by silence, and `no-deprecated-parts` had never fired outside RuleTester. Both now resolve the manifest in `before()` (`manifestFrom` caches by path, so the per-file lookup is a per-run read) and skip the file when it cannot be read. Verified against the exemplar with a scoped config: quiet on its tree, loud on an off-token probe.

  **`cutlist palette`** imports an external palette as the token source those rules enforce: `cutlist palette --file palette-01.json --out src/styles/palette.css` renders a Tailwind v4 `@theme` block from a vendor JSON file, preserving the file's group comments and normalizing `050` shades to the 50–900 class scale. Parsing is strict: anything that is not a brace, a blank, a comment, or an entry fails with a line number rather than guessing.

- 390f4fa: Three plumb rules read the agentic prose register in comments and string
  literals: `no-prose-verdict`, `no-antithesis-clause` and
  `no-anthropomorphic-program`. They are at `error` in this repository, with
  documented exemptions for spec files and for the three rule sources that quote
  the phrases they report.

  joggle gains `prose-voice`, a judged rule that reads JSDoc prose, Markdown and
  multi-word string literals, and `joggle prose`, which judges a commit message or
  a pull request body without walking the repository. Discovery now carries
  Markdown on `Workspace.prose` instead of counting it in `skippedExtensions`.

  `prose-voice` also carries six semantic labels from Clark, Martin and Mahowald
  (2026): `compression`, `stacked_nouns`, `reduced_relative`,
  `inanimate_subject`, `denominal` and `long_dependency`. They name a
  processing cost, not authorship: the existing candidate filters are unchanged, and
  there is no dependency parser and no frequency table.

## 0.6.3

### Patch Changes

- e6a6d56: `require-deprecated-tag-for-legacy-comments` says the tag must be inside the comment that names
  the retirement. A tag in the neighbouring block does not satisfy the rule, and the old message
  ("add `@deprecated`") read as if it did — the natural fix failed silently.

## 0.6.2

### Patch Changes

- da20164: First release published through npm's trusted publisher, so these tarballs carry a provenance
  attestation like the rest of the family.

  Every earlier version was uploaded with a token from a maintainer's machine. Provenance is the
  record of which repository and workflow built the tarball; `npm audit signatures` can check it,
  and it is the one thing a token-based publish cannot produce.

  `@autotelic/board` also declares `sideEffects: false`: it is Effect schema definitions and
  nothing else, so a bundler may drop what a reader never uses.

## 0.6.1

### Patch Changes

- a4139bf: `plumb-effect/require-schema-type-derivation` holds a baseline again.

  Two defects made it unusable on a real tree, and both are fixed:

  - its `createOnce` visitor kept the schema map across files, so an interface in `b.ts` was
    reported against a schema declared in `a.ts` -- at line 1, column 1, citing a name the file
    does not contain -- and the same tree answered 33/39/40 findings run to run. The maps are
    now emptied in `before`, which is the per-file hook `createOnce` provides.
  - it never read the `extends` clause, so `interface X extends Schema.Type<typeof XSchema>`
    -- the fix the rule asks for -- was reported as a hand-written twin. A heritage clause is
    now skipped.

  The rule is re-enabled at its normal severity in the root and `packages/joggle` configs,
  where it measures zero findings over repeat runs, so a regression is caught by this repo's own
  ratchet instead of an adopter's. `no-raw-error-forwarding` clears its catch stack in `before`
  for the same invariant.
