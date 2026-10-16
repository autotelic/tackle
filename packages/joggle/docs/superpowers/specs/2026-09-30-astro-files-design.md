# Reading `.astro` files

Stages 1 and 2 of Astro support: joggle reads the TypeScript inside `.astro`
files, and finds them whether or not it was given paths. An Astro preset
(`astro/prop-skips-content-type`, and possibly a rule about repeated inline
script behaviour) is later work and depends on this.

## Why

On an Astro codebase joggle currently analyses the utilities and nothing else.
The measuring repository, `auto-emdash/site`, has 44 `.astro` files and 4 `.ts`
files, so joggle sees about a tenth of it. Two findings are visible by hand that
existing rules would make once the frontmatter is readable: the `buttons` array
built identically in `Text.astro` and `SplitTextMedia.astro`, and
`entry.data.terms?.category?.[0]` written out in five files.

## What is read

An `.astro` file has three parts. Two of them are TypeScript:

| Part | Read? | Why |
| --- | --- | --- |
| frontmatter, between the `---` fences | yes | imports, `Props`, data loading: the component's logic |
| `<script>` blocks with no `type`, or `type="module"` | yes | client behaviour, written in TypeScript |
| the template, including `{expressions}` | no | needs the Astro compiler; deferred until a rule needs it |

Skipped `<script>` blocks: any other `type` (`application/ld+json` is data), and
any with `set:html` or `set:text`, whose content is not code. `is:inline`
scripts are read: they are not bundled, but they are still code someone wrote.

## How: blank everything that is not TypeScript

The parser is given a copy of the file in which every character outside a read
region is replaced by a space, and every newline is kept. Nothing moves: the
copy has the same length and the same line breaks as the original, so every
offset, line and column the parser reports is already correct for the real
file, `unit.text = text.slice(start, end)` slices the real file, and a
diagnostic points at the real line. There is no source map because there is
nothing to map.

The fences and the `<script>` and `</script>` tags are blanked too. All regions
go into one parse, as one module.

Positions: replace each UTF-16 code unit with one space, so JavaScript string
indices are unchanged. `workspace.ts` says the parser reports UTF-8 byte
offsets; a blanked non-ASCII character (`—`, three bytes) before a read region
would then shift every later byte offset. The first test settles which unit
the parser reports, using template text with non-ASCII characters before a
`<script>` block, and asserts the unit's text and location. If offsets are
bytes, each blanked character is replaced by as many spaces as it has UTF-8
bytes instead, and the test then also covers `unit.text`, since slicing a
JavaScript string by byte offsets would need the same conversion `.ts` files
with non-ASCII text already need.

### Two things Astro allows that a module does not

- **Top-level `return`.** Astro frontmatter can `return Astro.redirect(...)`.
  oxc reports "A 'return' statement can only be used within a function body"
  and still returns the complete AST (checked: the statements before and after
  are all present). For `.astro` files only, a parse whose only errors are
  that one is accepted. Any other error makes the file unparsed, reported as
  now.
- **Two scripts declaring the same name.** Each `<script>` is its own module in
  Astro and one module here. oxc's parser does not report redeclarations
  without `showSemanticErrors`, which joggle does not set (checked). The cost
  is that two scripts declaring the same name become two units with the same
  name in one file, which the name rules can treat as a candidate. Accepted:
  it is rare, and Jev reads both.

## Where it goes

- `src/source.ts`: `looksLikeSource` accepts `.astro`.
- `src/astro.ts` (new, kernel layer): `astroRegions(text)` returns the read
  regions, and `blankOutside(text, regions)` returns the copy. Both are pure, so
  both are tested without a parser.
- `src/workspace.ts`: `langOf` returns `ts` for `.astro`; `parseSourceFile`
  parses the blanked copy for an `.astro` file and applies the top-level
  `return` allowance. `SourceFile.text` stays the ORIGINAL text, so evidence
  excerpts show what the author wrote.
- `src/parsecache.ts`: bump `CACHE_VERSION`, because what a parse means for an
  `.astro` key has changed.
- `src/imports.ts`: nothing. `import Card from "./Card.astro"` names its
  extension, so the existing `""` entry in `EXTENSIONS` resolves it once
  `.astro` files are in the known set.

### `Props` is private to its component

Every Astro component declares `interface Props`, and Astro reads it by that
name, so it is never imported elsewhere. On `auto-emdash` that is 35 units
named `Props`, which the name-based rules (`naming-drift`, `duplicate-meaning`,
`one-concept-one-type`) would group as possible copies of one concept.

In an `.astro` file the `Props` unit is named after the component instead:
`ProjectCard.astro`'s becomes `ProjectCardProps`, which is what it would be
called in a `.tsx` codebase. Its location and text are still the real
`interface Props` line. The name rules then treat each one as its own
concept, and `field-type-drift` still compares their fields, which is the
"props drift" check, needing no new rule.

### Other rules that read `file.text`

`data-error-as-outage` re-parses `file.text` with `parseSync`. For an `.astro`
file that is the original text, which fails to parse and is skipped by its
existing `errors.length > 0` check, so it is silent rather than wrong. It
should use the blanked copy. `SourceFile` gets a `parseText` field, equal to
`text` for every other file, so no rule needs to know about Astro. The
implementation greps for every other `parseSync` call and `file.text` read in
`src/rules/` and handles each the same way.

## Finding `.astro` files with no paths (stage 2)

`tsgo --listFilesOnly` never lists `.astro` files; Astro typechecks them with
its own tooling. When joggle discovers files through tsgo, it also walks the
root for `.astro` files, honouring `.gitignore`, the ignored directories, and
the root tsconfig's `include` and `exclude`, and merges them in. The tsconfig
scope matters because tsgo applies it to everything it lists: without it,
joggle's own self-check read `tests/fixtures/astro`, which its tsconfig
excludes. Only `.astro` files are taken from
the walk, so the compiler still decides which TypeScript is in the project.

The walk runs on every no-paths run, not only when a `package.json` lists
`astro`: in a monorepo the dependency is in a workspace package rather than at
the root, and a gate there would reproduce the silent omission this fixes. The
walk is directory reads and stats; the parse cache's own measurement puts
read-and-parse at 2.3 of 2.4 seconds, so the walk is not where the time goes.
If it proves otherwise on a large repository, that is measured first.

## What this does not do

- Template expressions, components rendered in the template, and `client:*`
  directives are not read. `astro/island-earns-hydration` and
  `astro/page-shell-belongs-in-layout` need them and are not planned, because
  the measuring repository has neither islands nor more than one page shell.
- No type facts for `.astro` code: the tsgo trace does not cover it. Its units
  are typed by their own annotations (`typed`), as a `.ts` file's are, with no
  resolved `typeFacts`.
- `.md`, `.mdx`, `.svelte` and `.vue` stay unread, and keep appearing in the
  skipped-files note.

## Tests

- `astroRegions` and `blankOutside`: frontmatter only; frontmatter and two
  scripts; a `type="application/ld+json"` script skipped; no frontmatter; a
  `---` inside the template not mistaken for a fence; length and newlines
  preserved.
- Parsing a fixture `.astro` file: the frontmatter's units and imports appear
  with correct text and line numbers; a script's units appear; non-ASCII
  template text before a script does not move them; a top-level `return` is
  accepted; any other syntax error is reported as unparsed.
- `Props` is named after the component.
- Import graph: a `.ts` file importing `./Card.astro` resolves to it.
- Discovery with no paths: `.astro` files are found alongside tsgo's list,
  and a gitignored `.astro` file is not.
- Acceptance, by hand: `joggle check src` on `auto-emdash/site` parses all 44
  `.astro` files with none unparsed, and the run is written up in
  `docs/joggle-friction.md` with what the existing rules found.
