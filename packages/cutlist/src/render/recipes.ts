import {
  lexiconRef,
  type Catalog,
  type CatalogComponent,
  type Pattern,
  type PatternView,
  type Recipe,
  type RecipeImport,
  type RecipeMode,
  type RecipeView,
} from "@autotelic/protocol"

/*
 * `RECIPES.md` and `recipes.json`.
 *
 * A menu entry tells a reader what exists. A recipe gives the next turn: the import line, a
 * minimal shape that composes the part, the props the source declares, and the feature's
 * blocks and hook. It is deliberately a skeleton, not a generated app: the names are the
 * catalog's, and the adapter notes say where the real call site may spell them differently.
 */

const moduleOf = (path: string): string => path.replace(/\.(?:tsx?|jsx?)$/u, "")

const stemOf = (path: string): string => {
  const module = moduleOf(path)
  return module.slice(module.lastIndexOf("/") + 1)
}

const pascalOf = (name: string): string => {
  const parts = name.split(/[^A-Za-z0-9_$]+/u).filter((part) => part !== "")
  const joined = parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join("")
  return joined === "" ? "Part" : joined
}

const identifierOf = (name: string): string => {
  if (/^[A-Za-z_$][\w$]*$/u.test(name)) return name
  const pascal = pascalOf(name)
  return /^[A-Za-z_$][\w$]*/u.exec(pascal)?.[0] ?? "Part"
}

const pascalIdentifierOf = (name: string): string => {
  const pascal = pascalOf(name)
  return /^[A-Za-z_$][\w$]*/u.exec(pascal)?.[0] ?? "Part"
}

const importOf = ({
  path,
  binding,
  mode,
}: {
  readonly path: string
  readonly binding: string
  readonly mode: RecipeMode
}): RecipeImport => ({
  from: moduleOf(path),
  binding,
  mode,
})

const importLine = (recipeImport: RecipeImport): string => {
  if (recipeImport.mode === "namespace") {
    return `import * as ${recipeImport.binding} from "${recipeImport.from}"`
  }
  if (recipeImport.mode === "default") {
    return `import ${recipeImport.binding} from "${recipeImport.from}"`
  }
  return `import { ${recipeImport.binding} } from "${recipeImport.from}"`
}

const bindingOf = ({
  exports,
  path,
  name,
}: {
  readonly exports: ReadonlyArray<string>
  readonly path: string
  readonly name: string
}): RecipeImport => {
  const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "")
  const exact = exports.find(
    (candidate) => candidate !== "default" && normalized(candidate) === normalized(name),
  )
  if (exact !== undefined) return importOf({ path, binding: identifierOf(exact), mode: "named" })
  if (exports.includes("default")) {
    return importOf({ path, binding: pascalIdentifierOf(name), mode: "default" })
  }
  const named =
    exports.find((candidate) => candidate !== "default" && /^[A-Z]/u.test(candidate)) ??
    exports.find((candidate) => candidate !== "default" && candidate.startsWith("use")) ??
    exports.find((candidate) => candidate !== "default")
  if (named !== undefined) return importOf({ path, binding: identifierOf(named), mode: "named" })
  return importOf({ path, binding: pascalIdentifierOf(name), mode: "namespace" })
}

const bindingOfPart = (pattern: Pattern): RecipeImport =>
  bindingOf({ exports: pattern.exports, path: pattern.path, name: pattern.name })

const bindingOfComponent = (component: CatalogComponent): RecipeImport =>
  bindingOf({
    exports: component.exports ?? [],
    path: component.path,
    name: component.name,
  })

const STRING_PROPS: ReadonlySet<string> = new Set([
  "alt",
  "className",
  "href",
  "id",
  "name",
  "placeholder",
  "role",
  "size",
  "src",
  "title",
  "type",
  "variant",
])

const attributeOf = (prop: string): string => {
  if (STRING_PROPS.has(prop) || prop.startsWith("aria-")) return `${prop}="…"`
  if (prop.startsWith("on") && prop.length > 2 && /^[A-Z]/u.test(prop.charAt(2))) {
    return `${prop}={handler}`
  }
  return `${prop}={value}`
}

const usageOfPart = (pattern: Pattern, component: CatalogComponent | undefined): string => {
  const binding = bindingOfPart(pattern).binding
  if (component?.kind === "hook" || pattern.name.startsWith("use")) {
    return `const value = ${binding}()`
  }
  if (component?.kind === "context") return `const value = useContext(${binding})`
  if (component?.kind === "provider") return `<${binding}>…</${binding}>`
  if (component?.kind === "barrel") return `const value = ${binding}`
  const props = component?.props ?? []
  const attributes = props
    .filter((prop) => prop !== "children")
    .map(attributeOf)
    .join(" ")
  const children = props.includes("children") ? `>Example</${binding}>` : " />"
  return `<${binding}${attributes === "" ? "" : ` ${attributes}`}${children}`
}

const featureRecipe = (
  pattern: Pattern,
  byPath: ReadonlyMap<string, CatalogComponent>,
  byExport: ReadonlyMap<string, CatalogComponent>,
): Recipe | undefined => {
  const relation = (kind: string): string | undefined =>
    pattern.relations.find((candidate) => candidate.kind === kind)?.target
  const target = relation("barrel") ?? relation("provider") ?? relation("context")
  if (target === undefined) return undefined
  const hasBarrel = relation("barrel") !== undefined
  const targetComponent = byPath.get(target)
  const binding = hasBarrel
    ? identifierOf(pattern.name)
    : targetComponent === undefined
      ? identifierOf(stemOf(target))
      : bindingOfComponent(targetComponent).binding
  const mode: RecipeMode = "named"
  const blocks = pattern.blocks ?? []
  const provider = relation("provider")
  const providerComponent = provider === undefined ? undefined : byPath.get(provider)
  const providerBinding =
    provider === undefined
      ? undefined
      : providerComponent === undefined
        ? identifierOf(stemOf(provider))
        : bindingOfComponent(providerComponent).binding
  const wrapper =
    hasBarrel && provider !== undefined ? `${binding}.Provider` : (providerBinding ?? binding)
  const blockPaths = pattern.relations
    .filter((candidate) => candidate.kind === "block")
    .map((candidate) => candidate.target)
  const blockBindings = blockPaths.map((path) => {
    const component = byPath.get(path)
    return component === undefined
      ? identifierOf(stemOf(path))
      : bindingOfComponent(component).binding
  })
  const body =
    blockBindings.length === 0
      ? `  <${wrapper}>…</${wrapper}>`
      : [
          `  <${wrapper}>`,
          ...blockBindings.map((block) => `    <${block} />`),
          `  </${wrapper}>`,
        ].join("\n")
  const hook = pattern.hooks?.[0]
  const valueKeys = pattern.valueKeys ?? []
  const hookLine =
    hook === undefined
      ? undefined
      : valueKeys.length > 0
        ? `const { ${valueKeys.join(", ")} } = ${hook}()`
        : `const value = ${hook}()`
  const blockImports = pattern.relations
    .filter((candidate) => candidate.kind === "block")
    .flatMap((candidate) => {
      const component = byPath.get(candidate.target)
      return component === undefined ? [] : [bindingOfComponent(component)]
    })
  const hookImports = (pattern.hooks ?? []).flatMap((name) => {
    const component = byExport.get(name)
    return component === undefined ? [] : [bindingOfComponent(component)]
  })
  const extraImports = hasBarrel ? [] : [...blockImports, ...hookImports]
  return {
    id: pattern.id,
    name: pattern.name,
    kind: "feature",
    path: pattern.path,
    source: target,
    stability: pattern.stability,
    import: importOf({ path: target, binding, mode }),
    ...(extraImports.length === 0 ? {} : { extraImports }),
    usage: body,
    ...(blocks.length === 0 ? {} : { blocks }),
    ...(pattern.hooks === undefined ? {} : { hooks: pattern.hooks }),
    ...(valueKeys.length === 0 ? {} : { valueKeys }),
    notes: [
      ...(hookLine === undefined ? [] : [hookLine]),
      ...(hasBarrel
        ? [
            "The feature barrel carries the blocks and hook; use the object's keys if the call site spells them differently.",
          ]
        : ["Imports for the blocks and hook are listed above; the feature has no barrel."]),
    ],
  }
}

const partRecipe = (pattern: Pattern, component: CatalogComponent | undefined): Recipe => {
  const recipeImport = bindingOfPart(pattern)
  const notes: Array<string> = []
  if (pattern.feature !== undefined) notes.push(`part of \`${pattern.feature}\``)
  if (pattern.kind === "family") {
    notes.push(`canonical of ${pattern.relations.length} variant(s)`)
  } else {
    const variant = pattern.relations.find((relation) => relation.kind === "variant-of")
    if (variant !== undefined) notes.push(`variant of \`${variant.target}\``)
  }
  if (pattern.useInstead !== undefined && pattern.useInstead.length > 0) {
    notes.push(`use ${pattern.useInstead.join(", ")} instead`)
  }
  if (pattern.usedBy > 0) notes.push(`${pattern.usedBy} importer(s)`)
  return {
    id: pattern.id,
    name: pattern.name,
    kind: "part",
    path: pattern.path,
    source: pattern.path,
    stability: pattern.stability,
    import: recipeImport,
    usage: usageOfPart(pattern, component),
    ...(component?.props === undefined || component.props.length === 0
      ? {}
      : { props: component.props }),
    ...(pattern.blocks === undefined ? {} : { blocks: pattern.blocks }),
    ...(pattern.hooks === undefined ? {} : { hooks: pattern.hooks }),
    ...(pattern.valueKeys === undefined ? {} : { valueKeys: pattern.valueKeys }),
    notes,
  }
}

/** The recipes for the load-bearing parts and every composition. */
export const recipesOf = ({
  catalog,
  view,
}: {
  readonly catalog: Catalog
  readonly view: PatternView
}): RecipeView => {
  const byPath = new Map(catalog.components.map((component) => [component.path, component]))
  const byExport = new Map<string, CatalogComponent>()
  for (const component of catalog.components) {
    for (const name of component.exports ?? []) {
      if (name !== "default") byExport.set(name, component)
    }
  }
  const features = view.compositions
    .map((pattern) => featureRecipe(pattern, byPath, byExport))
    .filter((recipe): recipe is Recipe => recipe !== undefined)
  const seen = new Set<string>()
  const parts: Array<Recipe> = []
  for (const pattern of [...view.families, ...view.primitives, ...view.shared]) {
    if (seen.has(pattern.path)) continue
    seen.add(pattern.path)
    parts.push(partRecipe(pattern, byPath.get(pattern.path)))
  }
  return {
    lexicon: lexiconRef("recipes"),
    hash: view.hash,
    features,
    parts,
  }
}

const renderCode = (code: string, language = "text"): ReadonlyArray<string> => [
  `\`\`\`${language}`,
  code,
  "```",
]

/** The human reading: imports and shapes a person can paste into a scratch file. */
export const renderRecipes = (view: RecipeView): string => {
  const lines: Array<string> = [
    "# Recipes",
    "",
    `Generated by cutlist from \`${view.hash.slice(0, 12)}\`. Imports and shapes are derived from the catalog; the authored sentences come from \`intent/\`.`,
    "",
    "A recipe is a starting point, not a generated application. Copy the import, adapt the props and children to the call site, and use the pattern view for the forces behind the choice.",
    "",
    `## compositions (${view.features.length})`,
    "",
  ]
  for (const recipe of view.features) {
    lines.push(`### \`${recipe.name}\` — \`${recipe.path}\``, "")
    if (recipe.stability !== undefined) lines.push(`stability ${recipe.stability.toFixed(2)}`, "")
    lines.push(...renderCode(importLine(recipe.import)), "")
    for (const extra of recipe.extraImports ?? []) {
      lines.push(...renderCode(importLine(extra)), "")
    }
    lines.push("Shape:", "")
    lines.push(...renderCode(recipe.usage), "")
    if (recipe.blocks !== undefined && recipe.blocks.length > 0) {
      lines.push(`Blocks: ${recipe.blocks.map((block) => `\`${block}\``).join(", ")}` + "\n")
    }
    if (recipe.hooks !== undefined && recipe.hooks.length > 0) {
      lines.push(`Hooks: ${recipe.hooks.map((hook) => `\`${hook}\``).join(", ")}` + "\n")
    }
    if (recipe.notes.length > 0)
      lines.push(recipe.notes.map((note) => `- ${note}`).join("\n") + "\n")
  }

  lines.push(`## parts (${view.parts.length})`, "")
  for (const recipe of view.parts) {
    lines.push(`### \`${recipe.name}\` — \`${recipe.path}\``, "")
    if (recipe.stability !== undefined) lines.push(`stability ${recipe.stability.toFixed(2)}`, "")
    lines.push(...renderCode(importLine(recipe.import)), "")
    if (recipe.usage !== "") {
      lines.push("Use:", "")
      lines.push(...renderCode(recipe.usage), "")
    }
    if (recipe.props !== undefined && recipe.props.length > 0) {
      lines.push(`Props: ${recipe.props.map((prop) => `\`${prop}\``).join(", ")}` + "\n")
    }
    if (recipe.notes.length > 0)
      lines.push(recipe.notes.map((note) => `- ${note}`).join("\n") + "\n")
  }
  return `${lines.join("\n").trimEnd()}\n`
}

/** The same recipes for an agent building a mockup. */
export const renderRecipesJson = (view: RecipeView): string => `${JSON.stringify(view, null, 2)}\n`
