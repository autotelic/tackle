# The rule API, against oxlint's

`plumb` (the sibling linter) is built on `@oxlint/plugins`. joggle publishes its
own rule API. Reading the two side by side is worth doing, because the difference
is not the shape of a rule -- it is who the API is shaped *for*.

## Side by side

**plumb / oxlint**

```ts
export const rule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "…" },
    messages: { wideTuple: "This {{count}}-element tuple …" },
  },
  createOnce(context) {
    return {
      TSTupleType(node) {
        context.report({ node, messageId: "wideTuple", data: { count: String(n) } })
      },
    }
  },
})
```

**joggle**

```ts
export const rule = defineRule({
  id: "joggle/…", severity: "warn", description: "…", judged: false,
  run: Effect.fn("joggle/…")(function* (workspace, scope) {
    …
    return outcome([report({ at: unit, messageId: "…", data: { … } })])
  }),
})
```

## What plumb gets from oxlint, and joggle had to add

1. **A message registry.** `meta.messages` plus `report({ messageId, data })`
   separates the *wording* from the reporting site, so a rule's output is one
   reviewable vocabulary instead of strings assembled at every site.
2. **Report by subject.** `report({ node })` derives the span; a rule never
   computes a line. joggle's `finding` demanded a hand-built
   `{ file, line, column }`, and that bit: `object-shape` shipped every finding at
   line 1.
3. **`meta.type` (problem vs suggestion).** oxlint declares defect-vs-advice on
   the rule. joggle encodes it in `severity` ad hoc and, in one case
   (`compose-types`), decided report-vs-flag by hand.
4. **A standard tester.** oxlint ships `RuleTester`; plumb binds it to vitest with
   `makeTester()`.

And the biggest difference is not the rule shape at all: **plumb ships meta-rules
that lint rule authors** -- `require-create-once`, `require-rule-tester`,
`no-manual-ancestor-walks`, `prefer-before-file-scope`, `no-disable-directives`.
It treats the rule *author* as the user.

## What joggle is ahead on, and keeps

- **Cross-file by construction.** oxlint's `createOnce` visitor sees one file;
  plumb's `no-duplicated-literal-union` cannot see a duplicate in another file.
  joggle hands the rule the whole workspace, which is why
  `duplicate-implementation` exists at all.
- **The outcome funnel.** `outcome(diagnostics, notes, drops)` -- oxlint reports
  diagnostics only, with no record of what a rule considered and declined.
- **The judged layer.** `Decision`, `violations`, `verdictOf`, `qualityOf`,
  calibration, batching, caching, retry: oxlint has no model at all.

## The lesson

plumb is shaped so the easy path is the right path for an author: one
`defineRule`, a message registry, a node visitor, a `RuleTester`, and meta-rules
that reject the off-path. joggle had the *engine* discipline but the *authoring*
ergonomics were convention, not fence -- publishing a broad surface did not stop
an author (including this one) from shipping a rule with no `violations`, an
unbounded atom, an inline message, or no test.

## What was done about it

- `messages` + `reporter` + `locator` in `src/reporting.ts`: a rule declares its
  messages once and reports by subject. Every rule moved onto them
  (`docs/writing-rules.md`).
- `metaFindings` in `src/meta.ts`, enforced by `tests/meta-rules.test.ts`: the
  four invariants (`require-violations`, `require-test`, `bounded-atoms`,
  `band-the-answer`), with an explicit `meta-allow` opt-out. On first run it found
  fourteen real gaps, all now fixed or explicitly exempted.

## What remains

- **A declared kind.** oxlint's `meta.type` would make defect-vs-advice a
  declaration, so the `compose-types` decision (advice recorded, not printed)
  becomes a property of the rule rather than a per-rule policy.
- **A named tester.** `diagnosticsOf` / `plannedDiagnosticsOf` / `answeringModel`
  work, and now have a guide, but they are not yet a `RuleTester`-shaped harness a
  newcomer recognises.
