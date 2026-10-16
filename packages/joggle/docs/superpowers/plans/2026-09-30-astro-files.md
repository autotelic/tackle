# Reading `.astro` files: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** joggle reads the TypeScript in `.astro` files (frontmatter and `<script>` blocks) and finds them with or without paths.

**Architecture:** An `.astro` file is parsed from a copy in which everything outside the frontmatter and the readable `<script>` blocks is replaced by spaces, keeping newlines, so every offset the parser reports is already an offset into the real file. The pure helpers live in a new `src/astro.ts`; `workspace.ts` uses them when it parses, and discovery adds `.astro` files to tsgo's list in no-paths mode.

**Tech Stack:** TypeScript, Effect v4, `oxc-parser`, Vitest (`@effect/vitest`), pnpm.

Spec: `docs/superpowers/specs/2026-09-30-astro-files-design.md`.

## Global constraints

- Node 24.18 or later and pnpm 12.3.4. On this machine: `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` before every command. With the default Node 23 and pnpm 9, `pnpm install` rewrites `pnpm-lock.yaml` and every suite fails to import; never commit a changed lockfile.
- `pnpm check` (typecheck, tests, lint baseline) passes at the end of every task. Never run `pnpm lint:update` to accept a finding; fix it.
- `pnpm joggle check --offline` on joggle itself reports `0 problems` at the end of every task.
- Every new `src/` file is added to a layer in `joggle.config.json` (`kernel` for everything in this plan).
- Exported predicates are typed `Predicate.Predicate<T>` (`import type { Predicate } from "effect"`); the lint baseline rejects `(x: T): boolean` exports.
- Comments state constraints the code cannot show, in the surrounding files' voice. No comments narrating the change.
- oxc reports offsets in UTF-16 code units (measured: a declaration after `"// —— é 😀\n"` starts at 11, not 18).

## Files

| File | Change |
| --- | --- |
| `src/workspace.ts` | line table counts UTF-16 (Task 1); `langOf`, `parseSourceFile`, `Props` naming (Tasks 3, 4); `discoverFiles` (Task 6) |
| `src/cascade.ts`, `src/reporting.ts`, `src/rules/reimplemented-primitive.ts`, `src/rules/nullability-drift.ts` | import `lineStarts` from `workspace.ts` (Task 1) |
| `src/astro.ts` (new) | regions, blanking, parse input, tolerated errors, component name (Tasks 2, 3) |
| `src/source.ts` | `looksLikeSource` accepts `.astro` (Task 3) |
| `src/parsecache.ts` | `CACHE_VERSION` 9 → 10 (Task 3) |
| `src/rules/data-error-as-outage.ts` | parse the blanked copy (Task 5) |
| `src/tsconfig-scope.ts` (new) | the root tsconfig's `include`/`exclude` as a predicate (Task 6) |
| `joggle.config.json` | `src/astro.ts`, `src/tsconfig-scope.ts` in `kernel` |
| `tests/locations.test.ts`, `tests/astro.test.ts`, `tests/tsconfig-scope.test.ts` (new) | tests |
| `tests/fixtures/astro/**`, `tests/fixtures/data-error-astro/**` (new) | fixtures |
| `docs/joggle-friction.md` | the `auto-emdash` run (Task 7) |

---

### Task 1: Line numbers count UTF-16, not bytes (its own PR)

`workspace.ts` builds its line table from UTF-8 bytes while oxc reports UTF-16 offsets, so every declaration after non-ASCII text gets a wrong line. Measured: a file with two lines of `—` comments, `second` declared on line 5, is reported at line 2, column 6. This ships alone, before the Astro work, because it affects every repository.

**Files:**
- Modify: `src/workspace.ts:633-647` (delete `byteLineStarts` and its comment), `src/workspace.ts:1584` (use `lineStarts`)
- Modify: `src/cascade.ts:1-16` (move `lineStarts` out), `src/reporting.ts:5`, `src/rules/reimplemented-primitive.ts:4`, `src/rules/nullability-drift.ts:4`
- Test: `tests/locations.test.ts`

`lineStarts` moves from `cascade.ts` to `workspace.ts` rather than `workspace.ts` importing it from `cascade.ts`: `cascade.ts` already imports types from `workspace.ts`, and the other direction would make a type-only import cycle the architecture rules report.

**Interfaces:**
- Produces: `export const lineStarts: (text: string) => ReadonlyArray<number>` in `src/workspace.ts` (UTF-16 offsets, first entry 0). `lineAt` stays in `cascade.ts`.

- [ ] **Step 1: Branch from `main`**

```bash
cd /Users/estone/Projects/joggle && git checkout main && git pull --ff-only && git checkout -b fix/utf16-line-numbers
```

- [ ] **Step 2: Write the failing test** — `tests/locations.test.ts`

```ts
import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadWorkspace } from "../src/workspace.ts"

test("a declaration after non-ASCII text is located on its own line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-locations-"))
  writeFileSync(
    join(dir, "a.ts"),
    "// ——————————————————————————————\n// ——————————————————————————————\n\n\nexport function second() { return 2 }\n",
  )
  const workspace = await Effect.runPromise(
    loadWorkspace(dir, ["."]).pipe(Effect.provide(NodeServices.layer)),
  )
  const second = workspace.units.find((unit) => unit.name === "second")
  // The parser counts UTF-16 code units; a line table in bytes put this on line 2.
  expect(second?.location.line).toBe(5)
  expect(second?.location.column).toBe(1)
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/locations.test.ts`
Expected: FAIL, `expected 2 to be 5`.

- [ ] **Step 4: Move `lineStarts` and delete `byteLineStarts`**

In `src/cascade.ts`, delete the `lineStarts` function and its doc comment (lines 4-16) and add to the imports:

```ts
import { lineStarts, type Unit, type Workspace } from "./workspace.ts"
```

(replacing `import type { Unit, Workspace } from "./workspace.ts"`).

In `src/workspace.ts`, replace `byteLineStarts` and its comment (lines 633-647) with:

```ts
/**
 * The offset at which each line of a file begins, in UTF-16 code units.
 *
 * The unit the parser reports, so a parser offset and a line table agree. A
 * table in UTF-8 bytes put every declaration after an em dash on the wrong line.
 */
export const lineStarts = (text: string): ReadonlyArray<number> => {
  const found: Array<number> = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") found.push(index + 1)
  }
  return found
}
```

and at line 1584 change `const starts = byteLineStarts(text)` to `const starts = lineStarts(text)`.

In `src/reporting.ts`, `src/rules/reimplemented-primitive.ts` and `src/rules/nullability-drift.ts`, split the cascade import so `lineAt` still comes from `cascade.ts` and `lineStarts` from `workspace.ts`. For `reporting.ts`:

```ts
import { lineAt } from "./cascade.ts"
import { lineStarts } from "./workspace.ts"
```

and for the two rules:

```ts
import { lineAt } from "../cascade.ts"
import { lineStarts } from "../workspace.ts"
```

(merging into an existing `../workspace.ts` import if the file has one; both rules import `type Workspace` from it, so write `import { lineStarts, type Workspace } from "../workspace.ts"` and keep the rest of that import's names).

- [ ] **Step 5: Run the test, then everything**

Run: `pnpm vitest run tests/locations.test.ts && pnpm check && pnpm joggle check --offline 2>&1 | rg '^\d+ problems'`
Expected: test PASS; `pnpm check` green; `0 problems`.

- [ ] **Step 6: Commit, push, open the PR**

```bash
git add src/workspace.ts src/cascade.ts src/reporting.ts src/rules/reimplemented-primitive.ts src/rules/nullability-drift.ts tests/locations.test.ts
git commit -m "workspace: line numbers count UTF-16, the unit the parser reports"
git push -u origin fix/utf16-line-numbers
gh pr create --base main --title "workspace: line numbers count UTF-16, the unit the parser reports" --body "oxc reports offsets in UTF-16 code units; the line table counted UTF-8 bytes, so every declaration after non-ASCII text was reported on an earlier line (a function on line 5 after two lines of em dashes was reported at 2:6). The table now counts UTF-16, and it is the same function cascade.ts used, so there is one. Test: tests/locations.test.ts."
```

---

### Task 2: `astroRegions` and `blankOutside`

**Files:**
- Create: `src/astro.ts`
- Modify: `joggle.config.json` (add `"src/astro.ts"` to the `kernel` layer's `include`, after `"src/source.ts"`)
- Test: `tests/astro.test.ts`

- [ ] **Step 1: Set up the feature branch**

The Astro work builds on the tsgo discovery fix (PR #1, `src/source.ts`) and Task 1's line numbers.

```bash
git checkout design/astro-files && git checkout -b feat/astro-files
git merge --no-edit fix/tsgo-discovery-keeps-javascript fix/utf16-line-numbers
```

Expected: an octopus merge with no conflicts. If `main` has merged either PR by now, `git rebase main` instead.

**Interfaces:**
- Produces, from `src/astro.ts`:
  - `interface Region { readonly start: number; readonly end: number }` (UTF-16 offsets, `end` exclusive)
  - `astroRegions(text: string): ReadonlyArray<Region>`: the frontmatter's content, then each readable `<script>` block's content, in order
  - `blankOutside(text: string, regions: ReadonlyArray<Region>): string`: same length, newlines kept, everything outside the regions a space

- [ ] **Step 2: Write the failing tests** — `tests/astro.test.ts`

```ts
import { describe, expect, test } from "vitest"
import { astroRegions, blankOutside } from "../src/astro.ts"

const read = (text: string): ReadonlyArray<string> =>
  astroRegions(text).map((region) => text.slice(region.start, region.end))

describe("astroRegions", () => {
  test("the frontmatter is read, without its fences", () => {
    expect(read("---\nconst a = 1\n---\n<p>{a}</p>\n")).toEqual(["const a = 1\n"])
  })

  test("a file with no frontmatter has none", () => {
    expect(read("<p>hello</p>\n")).toEqual([])
  })

  test("a --- in the template is not a fence", () => {
    expect(read("<p>a</p>\n---\nconst b = 2\n---\n")).toEqual([])
  })

  test("script blocks are read after the frontmatter, in order", () => {
    const text = "---\nconst a = 1\n---\n<script>\nconst b = 2\n</script>\n<script type=\"module\">const c = 3</script>\n"
    expect(read(text)).toEqual(["const a = 1\n", "\nconst b = 2\n", "const c = 3"])
  })

  test("a script that is data or injected HTML is not read", () => {
    const text =
      "<script type=\"application/ld+json\">{\"a\":1}</script>\n<script set:html={x}></script>\n<script is:inline>const d = 4</script>\n"
    expect(read(text)).toEqual(["const d = 4"])
  })
})

describe("blankOutside", () => {
  test("keeps length, newlines and the regions, and blanks the rest", () => {
    const text = "---\nconst a = 1\n---\n<p>—</p>\n"
    const blanked = blankOutside(text, astroRegions(text))
    expect(blanked.length).toBe(text.length)
    expect(blanked).toBe("   \nconst a = 1\n   \n        \n")
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm vitest run tests/astro.test.ts`
Expected: FAIL, cannot resolve `../src/astro.ts`.

- [ ] **Step 4: Implement** — `src/astro.ts`

```ts
/**
 * The TypeScript inside an `.astro` file, located so the parser can read it in place.
 *
 * An `.astro` file is frontmatter, a template, and `<script>` blocks. The
 * frontmatter and the scripts are TypeScript; the template needs Astro's own
 * compiler and is not read. Rather than cutting the TypeScript out and mapping
 * positions back, everything else is blanked: the copy has the same length and
 * the same line breaks, so an offset into it is an offset into the file.
 */

/** A span of the file, in UTF-16 code units, end exclusive. */
export interface Region {
  readonly start: number
  readonly end: number
}

const OPENING_FENCE = /^\s*---[ \t]*\r?\n/
const CLOSING_FENCE = /^---[ \t]*\r?$/m
const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const TYPE = /\btype\s*=\s*["']?([^"'\s>]+)/i
const READABLE_TYPES = new Set(["module", "text/javascript", "application/javascript"])

/** Whether a script's attributes say its content is code joggle should read. */
const readableScript = (attributes: string): boolean => {
  if (/\bset:(?:html|text)\b/.test(attributes)) return false
  const type = TYPE.exec(attributes)?.[1]
  return type === undefined || READABLE_TYPES.has(type.toLowerCase())
}

/**
 * The frontmatter's content, then each readable script's content.
 *
 * The frontmatter only counts at the top of the file, as Astro reads it, so a
 * `---` further down is template text. Scripts are searched for after the
 * frontmatter: a `<script>` string inside the frontmatter is TypeScript.
 */
export const astroRegions = (text: string): ReadonlyArray<Region> => {
  const regions: Array<Region> = []
  let templateStart = 0
  const opening = OPENING_FENCE.exec(text)
  if (opening !== null) {
    const start = opening[0].length
    const closing = CLOSING_FENCE.exec(text.slice(start))
    if (closing !== null) {
      regions.push({ start, end: start + closing.index })
      templateStart = start + closing.index + closing[0].length
    }
  }
  for (const match of text.slice(templateStart).matchAll(SCRIPT)) {
    const attributes = match[1] ?? ""
    const content = match[2] ?? ""
    if (!readableScript(attributes)) continue
    const start = templateStart + match.index + match[0].indexOf(">") + 1
    regions.push({ start, end: start + content.length })
  }
  return regions
}

/** The file with every character outside the regions a space, and every newline kept. */
export const blankOutside = (text: string, regions: ReadonlyArray<Region>): string => {
  let out = ""
  let cursor = 0
  const blank = (from: number, to: number): string => text.slice(from, to).replace(/[^\r\n]/g, " ")
  for (const region of regions) {
    out += blank(cursor, region.start) + text.slice(region.start, region.end)
    cursor = region.end
  }
  return out + blank(cursor, text.length)
}
```

`/[^\r\n]/g` replaces each UTF-16 code unit, so a surrogate pair becomes two spaces and the length is kept.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/astro.test.ts`
Expected: 6 PASS.

- [ ] **Step 6: Register the module and check**

Add `"src/astro.ts"` to the `kernel` layer in `joggle.config.json`, then:

Run: `pnpm check && pnpm joggle check --offline 2>&1 | rg '^\d+ problems'`
Expected: green; `0 problems`.

- [ ] **Step 7: Commit**

```bash
git add src/astro.ts tests/astro.test.ts joggle.config.json
git commit -m "astro: locate the TypeScript in an .astro file, and blank the rest"
```

---

### Task 3: Parse `.astro` files

**Files:**
- Modify: `src/astro.ts` (add `isAstro`, `parseInputOf`, `blockingErrors`)
- Modify: `src/source.ts` (accept `.astro`)
- Modify: `src/workspace.ts` (`langOf`, `parseSourceFile`)
- Modify: `src/parsecache.ts:48` (`CACHE_VERSION = "10"`)
- Create: `tests/fixtures/astro/src/components/Card.astro`, `tests/fixtures/astro/src/pages/redirect.astro`, `tests/fixtures/astro/src/pages/broken.astro`, `tests/fixtures/astro/src/utils/use-card.ts`
- Test: `tests/astro.test.ts` (append)

**Interfaces:**
- Consumes: `astroRegions`, `blankOutside` (Task 2).
- Produces, from `src/astro.ts`:
  - `isAstro: Predicate.Predicate<string>` (a path ending `.astro`)
  - `parseInputOf(file: string, text: string): string` (the blanked copy for `.astro`, the text otherwise)
  - `blockingErrors<E extends { readonly message: string }>(file: string, errors: ReadonlyArray<E>): ReadonlyArray<E>` (for `.astro`, every error except a top-level `return`)

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/astro/src/components/Card.astro`:

```astro
---
// A card — with an em dash, so a byte-counted position would be wrong.
import { formatTitle } from "../utils/use-card.ts"

interface Props {
  title: string
  date: Date
}

const { title } = Astro.props
export const heading = formatTitle(title)
---
<article>
  <h2>{heading} — “quoted”</h2>
</article>
<script>
  function toggleCard(card: HTMLElement) {
    card.classList.toggle("open")
  }
  document.querySelectorAll<HTMLElement>("article").forEach(toggleCard)
</script>
<script type="application/ld+json">{"@type": "Article"}</script>
```

`tests/fixtures/astro/src/pages/redirect.astro`:

```astro
---
const target = Astro.url.searchParams.get("to")
if (target === null) return Astro.redirect("/")
export function destination() { return target }
---
<p>{target}</p>
```

`tests/fixtures/astro/src/pages/broken.astro`:

```astro
---
const = 1
---
<p>broken</p>
```

`tests/fixtures/astro/src/utils/use-card.ts`:

```ts
import Card from "../components/Card.astro"

export const formatTitle = (title: string): string => title.trim()
export const cardComponent = Card
```

- [ ] **Step 2: Write the failing tests** — append to `tests/astro.test.ts`

```ts
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { loadWorkspace } from "../src/workspace.ts"

const astroWorkspace = () =>
  Effect.runPromise(loadWorkspace("tests/fixtures/astro", ["src"]).pipe(Effect.provide(NodeServices.layer)))

describe("parsing .astro files", () => {
  test("frontmatter declarations are units with their real text and lines", async () => {
    const workspace = await astroWorkspace()
    const heading = workspace.units.find((unit) => unit.name === "heading")
    expect(heading?.file).toBe("src/components/Card.astro")
    expect(heading?.location.line).toBe(11)
    expect(heading?.text).toBe("heading = formatTitle(title)")
  })

  test("a script's declarations are units, located past non-ASCII template text", async () => {
    const workspace = await astroWorkspace()
    const toggle = workspace.units.find((unit) => unit.name === "toggleCard")
    expect(toggle?.file).toBe("src/components/Card.astro")
    expect(toggle?.location.line).toBe(17)
    expect(toggle?.text.startsWith("function toggleCard")).toBe(true)
  })

  test("a top-level return in the frontmatter is allowed", async () => {
    const workspace = await astroWorkspace()
    expect(workspace.units.some((unit) => unit.name === "destination")).toBe(true)
  })

  test("any other syntax error leaves the file unparsed, and says so", async () => {
    const workspace = await astroWorkspace()
    expect(workspace.unparsed.map((file) => file.path)).toEqual(["src/pages/broken.astro"])
  })

  test("an import of an .astro file resolves to it", async () => {
    const workspace = await astroWorkspace()
    const edge = workspace.imports.edges.find((entry) => entry.specifier === "../components/Card.astro")
    expect(edge?.resolution).toBe("resolved")
    expect(edge?.to).toBe("src/components/Card.astro")
  })
})
```

Check the expected values against the fixture before running: `heading` is on line 11 of `Card.astro`, `toggleCard` on line 17. A unit's `text` is its declarator for a `const` (as `.ts` files produce today); if the existing extractor yields `export const heading = …` for exported variables, the assertion is changed to match what a `.ts` file produces for the same line, which is checked with `loadWorkspace` on an equivalent `.ts` file, not guessed.

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm vitest run tests/astro.test.ts`
Expected: the 5 new tests FAIL (no `.astro` units; `unparsed` is empty because the files are not discovered); the Task 2 tests still PASS.

- [ ] **Step 4: Implement**

Append to `src/astro.ts`:

```ts
import type { Predicate } from "effect"

/** A path to an Astro component or page. */
export const isAstro: Predicate.Predicate<string> = (file) => file.endsWith(".astro")

/** What the parser reads for a file: the blanked copy for `.astro`, the text otherwise. */
export const parseInputOf = (file: string, text: string): string =>
  isAstro(file) ? blankOutside(text, astroRegions(text)) : text

/**
 * oxc's message for a `return` outside a function. Astro frontmatter may
 * `return Astro.redirect(...)`, and oxc still returns the whole tree with it.
 */
const TOP_LEVEL_RETURN = "A 'return' statement can only be used within a function body."

/** The errors that make a parse unusable: for `.astro`, all but a top-level `return`. */
export const blockingErrors = <E extends { readonly message: string }>(
  file: string,
  errors: ReadonlyArray<E>,
): ReadonlyArray<E> => (isAstro(file) ? errors.filter((error) => error.message !== TOP_LEVEL_RETURN) : errors)
```

(the `import type` goes at the top of the file, above the module comment's code).

`src/source.ts`: change the regex to

```ts
  return /\.(?:[cm]?[jt]sx?|astro)$/.test(file)
```

and add one sentence to its comment, after the declarations paragraph: `` `.astro` files count: their frontmatter and scripts are TypeScript, read through `astro.ts`. ``

`src/workspace.ts`, `langOf`: add a case before `default`:

```ts
    case ".astro":
      return "ts"
```

`src/workspace.ts`, `parseSourceFile`: replace the body with

```ts
const parseSourceFile = ({ file, text }: FileText): ParseOutcome => {
  const lang = langOf(file)
  const first = parseSync(file, parseInputOf(file, text), { sourceType: "module", lang })
  const errors = blockingErrors(file, first.errors)
  if (errors.length === 0) return { ok: true, file: sourceFileFrom({ file, text, parsed: first }) }

  if (lang === "js") {
    const retry = parseSync(file, text, { sourceType: "module", lang: "jsx" })
    if (retry.errors.length === 0) return { ok: true, file: sourceFileFrom({ file, text, parsed: retry }) }
  }
  return { ok: false, reason: describeParseErrors(errors) }
}
```

and add `import { blockingErrors, parseInputOf } from "./astro.ts"` beside the `./source.ts` import. `sourceFileFrom` is given the ORIGINAL text: every offset the parser reports lands inside a read region, where the original and the copy are identical, so unit text and evidence excerpts show what the author wrote.

`src/parsecache.ts`: `export const CACHE_VERSION = "10"`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/astro.test.ts tests/javascript.test.ts`
Expected: all PASS.

- [ ] **Step 6: Check, including joggle on itself**

Run: `pnpm check && pnpm joggle check --offline 2>&1 | rg '^\d+ problems'`
Expected: green; `0 problems`. The fixture is under `tests/fixtures`, which tsconfig excludes, so the no-paths self-check does not read it.

- [ ] **Step 7: Commit**

```bash
git add src/astro.ts src/source.ts src/workspace.ts src/parsecache.ts tests/astro.test.ts tests/fixtures/astro
git commit -m "workspace: parse the frontmatter and scripts of .astro files in place"
```

---

### Task 4: An Astro component's `Props` is named after it

**Files:**
- Modify: `src/astro.ts` (add `componentName`)
- Modify: `src/workspace.ts` (`parseSourceFile` renames the unit)
- Test: `tests/astro.test.ts` (append)

**Interfaces:**
- Consumes: `isAstro` (Task 3).
- Produces: `componentName(file: string): string` from `src/astro.ts`: the file's base name without `.astro`, non-identifier characters removed and the next letter capitalised, first letter capitalised (`ProjectCard.astro` → `ProjectCard`, `[slug].astro` → `Slug`, `index.astro` → `Index`).

- [ ] **Step 1: Write the failing tests** — append to `tests/astro.test.ts`

```ts
import { componentName } from "../src/astro.ts"

test("a component's name comes from its file", () => {
  expect(componentName("src/components/cards/ProjectCard.astro")).toBe("ProjectCard")
  expect(componentName("src/pages/[slug].astro")).toBe("Slug")
  expect(componentName("src/pages/work/index.astro")).toBe("Index")
  expect(componentName("src/pages/not-found.astro")).toBe("NotFound")
})

test("an .astro file's Props is named after the component, at its real line", async () => {
  const workspace = await astroWorkspace()
  const props = workspace.units.find((unit) => unit.file === "src/components/Card.astro" && unit.kind === "interface")
  expect(props?.name).toBe("CardProps")
  expect(props?.location.line).toBe(5)
  expect(props?.text.startsWith("interface Props")).toBe(true)
  expect(workspace.units.some((unit) => unit.name === "Props")).toBe(false)
})
```

(merge the `componentName` import into the existing `../src/astro.ts` import at the top.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm vitest run tests/astro.test.ts`
Expected: FAIL, `componentName` is not exported.

- [ ] **Step 3: Implement**

Append to `src/astro.ts`:

```ts
/**
 * The name Astro gives a component: its file's, as an identifier.
 *
 * Every component declares `interface Props`, and Astro reads it by that name,
 * so it is never imported elsewhere. Thirty-five units all called `Props` read
 * to the name rules as one concept spelled thirty-five times.
 */
export const componentName = (file: string): string => {
  const base = (file.split("/").at(-1) ?? file).replace(/\.astro$/, "")
  const words = base.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())
  return words.charAt(0).toUpperCase() + words.slice(1)
}
```

In `src/workspace.ts`, add `componentName` and `isAstro` to the `./astro.ts` import, and add above `parseSourceFile`:

```ts
/** An `.astro` file's `Props`, named after its component; any other file unchanged. */
const withComponentProps = (source: SourceFile): SourceFile =>
  !isAstro(source.path)
    ? source
    : {
        ...source,
        units: source.units.map((unit) =>
          unit.name === "Props" && (unit.kind === "interface" || unit.kind === "type")
            ? { ...unit, name: componentName(source.path) + "Props" }
            : unit,
        ),
      }
```

and in `parseSourceFile` wrap the first success: `return { ok: true, file: withComponentProps(sourceFileFrom({ file, text, parsed: first })) }`. The renamed unit is what the parse cache stores, so a cache hit returns it renamed.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/astro.test.ts`
Expected: all PASS.

- [ ] **Step 5: Check**

Run: `pnpm check && pnpm joggle check --offline 2>&1 | rg '^\d+ problems'`
Expected: green; `0 problems`.

- [ ] **Step 6: Commit**

```bash
git add src/astro.ts src/workspace.ts tests/astro.test.ts
git commit -m "workspace: an Astro component's Props is named after the component"
```

---

### Task 5: `data-error-as-outage` reads `.astro` files

The one rule that re-parses `file.text` itself. On an `.astro` file it parses the template, fails, and skips the file without saying so.

**Files:**
- Modify: `src/rules/data-error-as-outage.ts:192`
- Create: `tests/fixtures/data-error-astro/src/pages/crew.astro`
- Test: `tests/data-error.test.ts` (append)

**Interfaces:**
- Consumes: `isAstro`, `parseInputOf`, `blockingErrors` (Task 3).

- [ ] **Step 1: Confirm it is the only one**

Run: `rg -n 'parseSync' src/rules`
Expected: only `src/rules/data-error-as-outage.ts`. If another rule appears, it gets the same change and a test in this task.

- [ ] **Step 2: Write the fixture** — `tests/fixtures/data-error-astro/src/pages/crew.astro`

```astro
---
export async function getCrew(res, id) {
  const crew = await crewStore.fetchOne(id)
  if (crew === null) {
    res.statusCode = 503
    return
  }
  res.send(crew)
}
---
<p>crew</p>
```

- [ ] **Step 3: Write the failing test** — append to `tests/data-error.test.ts`

```ts
it.effect("an .astro file's frontmatter is read for the same shape", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/data-error-astro", ["src"])
    const result = yield* plannedDiagnosticsOf(dataErrorAsOutage, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("getCrew")
    expect(result.diagnostics[0]?.location.file).toBe("src/pages/crew.astro")
  }).pipe(Effect.provide(modelStub(allRow)), Effect.provide(NodeServices.layer)),
)
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm vitest run tests/data-error.test.ts`
Expected: the new test FAILS with `expected 0 to be 1`; the four existing tests PASS.

- [ ] **Step 5: Implement**

In `src/rules/data-error-as-outage.ts`, replace

```ts
    const parsed = parseSync(file.path, file.text)
    if (parsed.errors.length > 0) continue
```

with

```ts
    const parsed = parseSync(
      file.path,
      parseInputOf(file.path, file.text),
      isAstro(file.path) ? { sourceType: "module", lang: "ts" } : undefined,
    )
    if (blockingErrors(file.path, parsed.errors).length > 0) continue
```

and add `import { blockingErrors, isAstro, parseInputOf } from "../astro.ts"`.

- [ ] **Step 6: Run the tests and check**

Run: `pnpm vitest run tests/data-error.test.ts && pnpm check && pnpm joggle check --offline 2>&1 | rg '^\d+ problems'`
Expected: 5 PASS; green; `0 problems`.

- [ ] **Step 7: Commit**

```bash
git add src/rules/data-error-as-outage.ts tests/data-error.test.ts tests/fixtures/data-error-astro
git commit -m "data-error-as-outage: read an .astro file's frontmatter, not its template"
```

---

### Task 6: No-paths runs find `.astro` files

`tsgo --listFilesOnly` never lists `.astro` files. Discovery walks the root for them, honouring `.gitignore`, the ignored directories, and the root tsconfig's `include` and `exclude`: the compiler applies those to every file it lists, and without them joggle's own self-check would read `tests/fixtures/astro`, which its tsconfig excludes. This amends the spec, which named only `.gitignore` and the ignored directories.

**Files:**
- Create: `src/tsconfig-scope.ts`
- Modify: `src/workspace.ts` (`discoverFiles`)
- Modify: `joggle.config.json` (add `"src/tsconfig-scope.ts"` to `kernel`)
- Modify: `docs/superpowers/specs/2026-09-30-astro-files-design.md` (the stage 2 paragraph names tsconfig scope)
- Create: `tests/fixtures/astro/tsconfig.json`, `tests/fixtures/astro/.gitignore`, `tests/fixtures/astro/src/ignored/Skipped.astro`, `tests/fixtures/astro/outside/Outside.astro`
- Test: `tests/tsconfig-scope.test.ts`, `tests/astro.test.ts` (append)

**Interfaces:**
- Consumes: `isAstro` (Task 3); `globSource` from `src/glob.ts`.
- Produces: `tsconfigScope(root: string): Effect.Effect<Predicate.Predicate<string>, never, FileSystem.FileSystem | Path.Path>` from `src/tsconfig-scope.ts`. The predicate takes a root-relative path with `/` separators. No tsconfig, or one that is not plain JSON, accepts every path.

- [ ] **Step 1: Write the fixtures**

`tests/fixtures/astro/tsconfig.json`:

```json
{ "include": ["src"], "exclude": ["src/pages/broken.astro"] }
```

`tests/fixtures/astro/.gitignore`:

```
src/ignored/
```

`tests/fixtures/astro/src/ignored/Skipped.astro` and `tests/fixtures/astro/outside/Outside.astro`, each:

```astro
---
const unused = 1
---
```

The new `exclude` does not change Task 3's tests: they load with paths, which never consults tsconfig.

- [ ] **Step 2: Write the failing tests**

`tests/tsconfig-scope.test.ts`:

```ts
import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tsconfigScope } from "../src/tsconfig-scope.ts"

const scopeOf = (tsconfig: string | undefined) => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-scope-"))
  if (tsconfig !== undefined) writeFileSync(join(dir, "tsconfig.json"), tsconfig)
  return Effect.runPromise(tsconfigScope(dir).pipe(Effect.provide(NodeServices.layer)))
}

test("a directory in include covers everything under it", async () => {
  const inScope = await scopeOf(JSON.stringify({ include: ["src"] }))
  expect(inScope("src/pages/index.astro")).toBe(true)
  expect(inScope("tests/a.astro")).toBe(false)
})

test("a glob in include matches at any depth", async () => {
  const inScope = await scopeOf(JSON.stringify({ include: ["src/**/*"] }))
  expect(inScope("src/a.astro")).toBe(true)
  expect(inScope("src/pages/a.astro")).toBe(true)
})

test("exclude wins over include", async () => {
  const inScope = await scopeOf(JSON.stringify({ include: ["src", "tests"], exclude: ["tests/fixtures"] }))
  expect(inScope("tests/a.astro")).toBe(true)
  expect(inScope("tests/fixtures/astro/src/Card.astro")).toBe(false)
})

test("no tsconfig, or one that is not plain JSON, scopes nothing out", async () => {
  expect((await scopeOf(undefined))("anything/a.astro")).toBe(true)
  expect((await scopeOf("{ // a comment\n }"))("anything/a.astro")).toBe(true)
})
```

Append to `tests/astro.test.ts`:

```ts
import { resolve } from "node:path"
import { discoverFiles } from "../src/workspace.ts"

test("with no paths, .astro files join tsgo's list, within tsconfig and outside .gitignore", async () => {
  const root = resolve("tests/fixtures/astro")
  const fromTsgo = [resolve(root, "src/utils/use-card.ts")]
  const found = await Effect.runPromise(
    discoverFiles(root, [], fromTsgo).pipe(Effect.provide(NodeServices.layer)),
  )
  const relative = found.files.map((file) => file.slice(root.length + 1)).sort()
  expect(relative).toEqual([
    "src/components/Card.astro",
    "src/pages/redirect.astro",
    "src/utils/use-card.ts",
  ])
})
```

(merge the `discoverFiles` import into the existing `../src/workspace.ts` import.)

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm vitest run tests/tsconfig-scope.test.ts tests/astro.test.ts`
Expected: `tsconfig-scope` FAILS to resolve the module; the discovery test FAILS with only `src/utils/use-card.ts`.

- [ ] **Step 4: Implement** — `src/tsconfig-scope.ts`

```ts
import { Effect, FileSystem, Path, type Predicate } from "effect"
import { globSource } from "./glob.ts"

/**
 * The root tsconfig's `include` and `exclude`, for files the compiler cannot list.
 *
 * tsgo applies them to every file it lists; an `.astro` file found by walking
 * has to be held to the same scope, or a run reads what the project excluded.
 * Only the root file is read: `extends` is not followed, and a tsconfig that is
 * not plain JSON scopes nothing out rather than guessing.
 */

const GLOB = /[*?]/

/** One include or exclude entry: a glob, or a path that covers itself and everything under it. */
const entryMatcher = (entry: string): Predicate.Predicate<string> => {
  const pattern = entry.replace(/^\.\//, "").replace(/\/$/, "")
  if (!GLOB.test(pattern)) return (file) => file === pattern || file.startsWith(pattern + "/")
  const regex = new RegExp("^" + globSource(pattern, { question: true, doubleStarSkipsSlash: true }) + "$")
  return (file) => regex.test(file)
}

const stringsIn = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []

const everything: Predicate.Predicate<string> = () => true

export const tsconfigScope = (
  root: string,
): Effect.Effect<Predicate.Predicate<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const body = yield* Effect.orElseSucceed(fs.readFileString(path.join(root, "tsconfig.json")), () => undefined)
    if (body === undefined) return everything
    const parsed = yield* Effect.orElseSucceed(Effect.try(() => JSON.parse(body) as unknown), () => undefined)
    if (typeof parsed !== "object" || parsed === null) return everything
    const config = new Map(Object.entries(parsed))
    const include = stringsIn(config.get("include")).map(entryMatcher)
    const exclude = stringsIn(config.get("exclude")).map(entryMatcher)
    return (file) =>
      (include.length === 0 || include.some((matches) => matches(file))) &&
      !exclude.some((matches) => matches(file))
  })
```

The `as unknown` widens `JSON.parse`'s `any` and is followed by a check, not a cast to a shape; if the lint baseline rejects it, replace it with `const parsed: unknown = yield* …` and drop the `as`.

In `src/workspace.ts`, `discoverFiles`: replace the `discovered !== undefined` branch with

```ts
  discovered !== undefined
    ? Effect.gen(function* () {
        const path = yield* Path.Path
        const inScope = yield* tsconfigScope(root)
        const walked = yield* resolveInputs(root, ["."])
        const astro = walked.files.filter(
          (file) => isAstro(file) && inScope(path.relative(root, file).split(path.sep).join("/")),
        )
        return {
          files: [...discovered, ...astro].sort(Order.String),
          skippedExtensions: [],
          truncated: walked.truncated,
          ignored: 0,
          ignoredDirectories: 0,
        }
      })
```

and add `import { tsconfigScope } from "./tsconfig-scope.ts"`. `truncated` comes from the walk because a truncated walk may have missed `.astro` files; the skipped and ignored counts stay zero because tsgo, not the walk, decides what TypeScript is in the project.

Add `"src/tsconfig-scope.ts"` to the `kernel` layer in `joggle.config.json`. In the spec's stage 2 section, change "honouring `.gitignore` and the ignored directories as the walk already does" to "honouring `.gitignore`, the ignored directories, and the root tsconfig's `include` and `exclude`".

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/tsconfig-scope.test.ts tests/astro.test.ts`
Expected: all PASS.

- [ ] **Step 6: Check, including the self-check's file count**

Run: `pnpm check && pnpm joggle check --offline 2>&1 | rg '^\d+ problems|parsed .* file'`
Expected: green; `0 problems`; the same file count as before this task (146 at the time of writing), because joggle's tsconfig excludes `tests/fixtures`.

- [ ] **Step 7: Commit**

```bash
git add src/tsconfig-scope.ts src/workspace.ts joggle.config.json docs/superpowers/specs/2026-09-30-astro-files-design.md tests/tsconfig-scope.test.ts tests/astro.test.ts tests/fixtures/astro
git commit -m "discovery: a no-paths run finds .astro files, within the project's tsconfig"
```

---

### Task 7: Acceptance on `auto-emdash`, and the PR

**Files:**
- Modify: `docs/joggle-friction.md` (append an entry in the file's existing format)

- [ ] **Step 1: Run joggle on the site, with paths and without**

```bash
cd /Users/estone/Projects/auto-emdash/site
node --conditions=development /Users/estone/Projects/joggle/src/main.ts check src 2>&1 | tee /tmp/emdash-paths.txt
node --conditions=development /Users/estone/Projects/joggle/src/main.ts check 2>&1 | tee /tmp/emdash-nopaths.txt
```

Without `TYPESAFE_API_KEY` the judged rules report unverified; that is expected here. If the key is available (the `scripts/joggle.sh` wrapper finds it through doppler), run that instead to see judged results.

Expected in both: the extraction note counts 48 files (44 `.astro`, 4 `.ts`, less any tsconfig excludes), and no `.astro` file is reported unparsed. Any unparsed `.astro` file is a bug in this plan's code: add its case as a fixture test in `tests/astro.test.ts`, fix it, and rerun.

- [ ] **Step 2: Record what the existing rules found**

Read the two outputs. Note, with file and line: whether the `buttons` construction in `Text.astro` and `SplitTextMedia.astro` was found, whether `entry.data.terms?.category?.[0]` across five files was, any finding that is noise, and the run time. Append an entry to `docs/joggle-friction.md` matching the format of the entries already there.

- [ ] **Step 3: Commit, push, open the PR**

```bash
cd /Users/estone/Projects/joggle
git add docs/joggle-friction.md
git commit -m "friction: the first run on an Astro site"
git push -u origin feat/astro-files
gh pr create --base main --title "Read .astro files" --body-file - <<'EOF'
joggle reads the TypeScript in `.astro` files: the frontmatter and `<script>` blocks, parsed in place from a copy with everything else blanked, so positions need no mapping. A component's `Props` is named after it. `data-error-as-outage` reads the frontmatter rather than failing on the template. A no-paths run finds `.astro` files within the root tsconfig's scope, since tsgo never lists them.

Design: `docs/superpowers/specs/2026-09-30-astro-files-design.md`. Plan: `docs/superpowers/plans/2026-09-30-astro-files.md`.

Depends on #1 (tsgo discovery) and the UTF-16 line-number PR; merge those first.

Acceptance: `auto-emdash/site`, 44 `.astro` files, none unparsed; findings in `docs/joggle-friction.md`.
EOF
```
