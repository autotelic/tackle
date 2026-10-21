import type { LexiconRef } from "./lexicon.ts"
import { arrayOf, isRecord, num, oneOf, readLexiconRef, str, strings } from "./decode.ts"

/*
 * The recipe view.
 *
 * A recipe is the next turn after a pattern choice: the import, a minimal shape, the props,
 * and the feature's blocks and hook. It is derived from the catalog and the pattern view, and
 * it crosses to `jig` as bytes, so it has its own tiny lexicon.
 */

export type RecipeMode = "named" | "default" | "namespace"

export interface RecipeImport {
  readonly from: string
  readonly binding: string
  readonly mode: RecipeMode
}

export interface Recipe {
  readonly id: string
  readonly name: string
  readonly kind: "feature" | "part"
  readonly path: string
  readonly source: string
  readonly stability?: number
  readonly import: RecipeImport
  readonly extraImports?: ReadonlyArray<RecipeImport>
  readonly usage: string
  readonly props?: ReadonlyArray<string>
  readonly blocks?: ReadonlyArray<string>
  readonly hooks?: ReadonlyArray<string>
  readonly valueKeys?: ReadonlyArray<string>
  readonly notes: ReadonlyArray<string>
}

export interface RecipeView {
  readonly lexicon: LexiconRef
  readonly hash: string
  readonly features: ReadonlyArray<Recipe>
  readonly parts: ReadonlyArray<Recipe>
}

const MODES: ReadonlyArray<RecipeMode> = ["named", "default", "namespace"]

const decodeImport = (value: unknown): RecipeImport | undefined => {
  if (!isRecord(value)) return undefined
  const from = str(value.from)
  const binding = str(value.binding)
  const mode = oneOf(value.mode, MODES)
  if (from === undefined || binding === undefined || mode === undefined) return undefined
  return { from, binding, mode }
}

/** Read one recipe, or `undefined` when it is not one. */
export const decodeRecipe = (value: unknown): Recipe | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const name = str(value.name)
  const kind = oneOf(value.kind, ["feature", "part"] as const)
  const path = str(value.path)
  const source = str(value.source)
  const recipeImport = decodeImport(value.import)
  const usage = str(value.usage)
  const notes = strings(value.notes)
  if (
    id === undefined ||
    name === undefined ||
    kind === undefined ||
    path === undefined ||
    source === undefined ||
    recipeImport === undefined ||
    usage === undefined ||
    notes === undefined
  ) {
    return undefined
  }
  const stability = num(value.stability)
  const extraImports =
    "extraImports" in value ? arrayOf(value.extraImports, decodeImport) : undefined
  const props = "props" in value ? strings(value.props) : undefined
  const blocks = "blocks" in value ? strings(value.blocks) : undefined
  const hooks = "hooks" in value ? strings(value.hooks) : undefined
  const valueKeys = "valueKeys" in value ? strings(value.valueKeys) : undefined
  return {
    id,
    name,
    kind,
    path,
    source,
    import: recipeImport,
    usage,
    notes,
    ...(stability === undefined ? {} : { stability }),
    ...(extraImports === undefined ? {} : { extraImports }),
    ...(props === undefined ? {} : { props }),
    ...(blocks === undefined ? {} : { blocks }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(valueKeys === undefined ? {} : { valueKeys }),
  }
}

/** Read a recipe view, or `undefined` when the bytes are not one. */
export const decodeRecipeView = (value: unknown): RecipeView | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "recipes")
  const hash = str(value.hash)
  const features = arrayOf(value.features, decodeRecipe)
  const parts = arrayOf(value.parts, decodeRecipe)
  if (
    lexicon === undefined ||
    hash === undefined ||
    features === undefined ||
    parts === undefined
  ) {
    return undefined
  }
  return { lexicon, hash, features, parts }
}
