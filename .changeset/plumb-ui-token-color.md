---
"@autotelic/plumb": minor
"@autotelic/cutlist": minor
---

`plumb-ui` gains `no-off-token-color`, and both catalog rules now resolve the manifest per file — the only place oxlint gives a rule its options.

**`no-off-token-color`** is the second catalog rule: every color in a file must name a member of the manifest's declared color set, the closed set cutlist extracts into `colors`. It reports off-palette classes (`text-red-500` when `red` was never declared), hard-coded values (`bg-[#334e68]`, `border-[rgb(…)]`), undeclared variables (`bg-(--brand)`), SVG paint literals (`<svg fill="#334e68">`), and inline style colors (`style={{ color: "#fff" }}`). Non-color readings of shared prefixes are excluded (`text-sm` is a size, `border-2` a width, `divide-x` an axis), keywords pass (`bg-transparent`), and a declared scale root covers its shades (`red-500` passes when `red` is declared — the manifest's flat keys cannot judge shade completeness). It fails open when the manifest is missing, malformed, or carries no `colors`.

**Options are per-file in oxlint.** `createOnce` runs at plugin registration, when `context.options` is still `null`; the configured options exist only in `before()` and the visitors. Both catalog rules read the manifest at createOnce and so returned `{}` in every real run — green by silence, and `no-deprecated-parts` had never fired outside RuleTester. Both now resolve the manifest in `before()` (`manifestFrom` caches by path, so the per-file lookup is a per-run read) and skip the file when it cannot be read. Verified against the exemplar with a scoped config: quiet on its tree, loud on an off-token probe.

**`cutlist palette`** imports an external palette as the token source those rules enforce: `cutlist palette --file palette-01.json --out src/styles/palette.css` renders a Tailwind v4 `@theme` block from a vendor JSON file, preserving the file's group comments and normalizing `050` shades to the 50–900 class scale. Parsing is strict: anything that is not a brace, a blank, a comment, or an entry fails with a line number rather than guessing.
