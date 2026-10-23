import { Effect, FileSystem, Path } from "effect"
import type { Menu, ResolvedCutlistOutput } from "@autotelic/protocol"
import {
  compareCatalog,
  compareJson,
  compareMenu,
  compareText,
  type StalenessResult,
} from "./check.ts"

/*
 * Every file a build writes, in one table.
 *
 * `build` and `--check` both iterate this list, so a file can never be written and left
 * unchecked. That was a real hole: `plumb-ui.config.json` is the lint manifest and
 * `plumb-ui` fails OPEN on a stale one, so a manifest the gate skipped meant every tier
 * rule went quiet while the run still printed "up to date".
 *
 * The comparison is per file because the files are not the same kind of thing: the
 * catalog carries its own hash, the menu and the JSON views are compared by model, and
 * the renderings are compared by bytes. Formatting must never be able to fail the gate,
 * which is why the model comparisons parse before comparing.
 */

/** How `--check` decides a file is current. */
export type Compare =
  | { readonly kind: "catalog"; readonly hash: string }
  | { readonly kind: "menu"; readonly menu: Menu }
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "text" }

export interface OutputFile {
  readonly file: string
  /** The bytes `build` writes and `--check` compares against. */
  readonly text: string
  readonly compare: Compare
}

/** Every rendering, already rendered. `diagrams` is the dynamic half of the set. */
export interface Renderings {
  readonly catalog: string
  readonly manifest: string
  readonly menuJson: string
  readonly menu: string
  readonly patterns: string
  readonly patternsJson: string
  readonly recipes: string
  readonly recipesJson: string
  readonly hooks: string
  readonly tokens: string
  readonly diagrams: ReadonlyArray<readonly [string, string]>
}

/** The configured outputs paired with the bytes and the comparison each one needs. */
export const outputsOf = ({
  output,
  renderings,
  catalogHash,
  menu,
}: {
  readonly output: ResolvedCutlistOutput
  readonly renderings: Renderings
  readonly catalogHash: string
  readonly menu: Menu
}): ReadonlyArray<OutputFile> => [
  {
    file: output.catalog,
    text: renderings.catalog,
    compare: { kind: "catalog", hash: catalogHash },
  },
  // The lint manifest and the two text vocabularies are generator-canonical: a byte
  // difference means the model moved, not that a formatter reflowed it.
  { file: output.manifest, text: renderings.manifest, compare: { kind: "text" } },
  { file: output.menuJson, text: renderings.menuJson, compare: { kind: "menu", menu } },
  { file: output.menu, text: renderings.menu, compare: { kind: "text" } },
  { file: output.patterns, text: renderings.patterns, compare: { kind: "text" } },
  {
    file: output.patternsJson,
    text: renderings.patternsJson,
    compare: { kind: "json", value: JSON.parse(renderings.patternsJson) },
  },
  { file: output.recipes, text: renderings.recipes, compare: { kind: "text" } },
  {
    file: output.recipesJson,
    text: renderings.recipesJson,
    compare: { kind: "json", value: JSON.parse(renderings.recipesJson) },
  },
  { file: output.hooks, text: renderings.hooks, compare: { kind: "text" } },
  { file: output.tokens, text: renderings.tokens, compare: { kind: "text" } },
  // Opt-in: no configured directory means the projection was not rendered, so there is
  // nothing to write even if a caller passed a list.
  ...(output.diagrams === undefined
    ? []
    : renderings.diagrams.map(([file, text]) => ({
        file,
        text,
        compare: { kind: "text" as const },
      }))),
]

/** Compare one table entry against the committed file it names. */
export const compareOutput = (
  output: OutputFile,
): Effect.Effect<StalenessResult, never, FileSystem.FileSystem | Path.Path> => {
  const comparison = output.compare
  switch (comparison.kind) {
    case "catalog":
      return compareCatalog({ file: output.file, hash: comparison.hash })
    case "menu":
      return compareMenu({ file: output.file, fresh: comparison.menu })
    case "json":
      return compareJson({ file: output.file, fresh: comparison.value })
    case "text":
      return compareText({ file: output.file, fresh: output.text })
  }
}
