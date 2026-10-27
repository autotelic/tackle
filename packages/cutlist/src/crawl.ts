import { Effect, FileSystem, Order, Path, Predicate } from "effect"
import { parseSync } from "oxc-parser"

/*
 * Pass 1 — parse.
 *
 * Every module reduces to the same small record: what it exports, what it imports,
 * what JSX it renders, what hooks it calls, what props it declares, and whether it
 * carries a documentation block. Everything downstream — the use-graph, tiers,
 * signatures — is computed from records like these, never from a second AST walk.
 *
 * The AST is walked as loosely-typed data on purpose. oxc's node types are a large
 * union and the crawler asks only a handful of shape questions; naming every node type
 * would buy nothing and couple this pass to a parser version.
 */

/** An object literal, and the name it was bound to when it has one. */
export interface ObjectLiteral {
  /** The declarator's name — `Settings` in `export const Settings = { … }`. */
  readonly name?: string
  /** The keys written in source order. Spread properties contribute none. */
  readonly keys: ReadonlyArray<string>
}

/** One declaration in a module. A part's kind is a question about these, not about the file. */
export interface Declaration {
  readonly name: string
  readonly kind: "function" | "class" | "variable" | "type"
  readonly exported: boolean
  /** Whether the declaration's own body renders JSX. */
  readonly renders: boolean
  /** Callee names inside the declaration; `useState`, `createContext`, `memo`. */
  readonly calls: ReadonlyArray<string>
  /** JSX tags inside the declaration, so one file's declarations can be asked separately. */
  readonly tags: ReadonlyArray<string>
  /** Keys, when a variable is bound to an object literal. */
  readonly objectKeys?: ReadonlyArray<string>
}

/** A JSX element as written, with where it was written. */
export interface RenderSite {
  readonly tag: string
  /** One-based line in the module. */
  readonly line: number
}

/**
 * One import statement's specifier and the local names it binds.
 *
 * The specifier alone is enough for the use-graph, which only asks "who imported whom".
 * Resolving a rendered tag is a different question — `<Card>` means `./ui/card.tsx` only
 * if this file bound `Card` to it — so the binding is read once, here, and the render edges
 * are a lookup over it rather than a second walk of the imports.
 */
export interface ImportEdge {
  readonly specifier: string
  readonly bindings: ReadonlyArray<string>
}

/** One parsed module, reduced to what the catalog needs. */
export interface SourceModule {
  /** Repository-relative, forward-slashed. */
  readonly path: string
  readonly exports: ReadonlyArray<string>
  /** Every imported specifier, deduplicated: the use-graph and the signature read this. */
  readonly imports: ReadonlyArray<string>
  /** Each import with the local names it introduces; `imports` is derived from these. */
  readonly importEdges: ReadonlyArray<ImportEdge>
  readonly tags: ReadonlyArray<string>
  /** Every JSX element with its line; `tags` is derived from these. */
  readonly renders: ReadonlyArray<RenderSite>
  readonly hooks: ReadonlyArray<string>
  readonly props: ReadonlyArray<string>
  /** Object literals in the module. The composition pattern lives in their keys. */
  readonly objects: ReadonlyArray<ObjectLiteral>
  /** Declarations in source order. The unit a kind is assigned to. */
  readonly declarations: ReadonlyArray<Declaration>
  /** Whether the module calls `createContext` — the pattern's structural signature. */
  readonly createsContext: boolean
  readonly documented: boolean
}

type Ast = Record<string, unknown> & { type?: unknown }

const asRecord = (value: unknown): Ast | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Ast) : undefined

const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])

const stringField = (value: unknown, key: string): string | undefined => {
  const field = asRecord(value)?.[key]
  return typeof field === "string" ? field : undefined
}

const nameOf = (value: unknown): string | undefined => stringField(value, "name")

/** Visit every node with a `type` once. Cycle-guarded; oxc's tree has no parent links. */
const walk = (root: unknown, visit: (node: Ast) => void): void => {
  const seen = new Set<object>()
  const step = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) step(item)
      return
    }
    const record = asRecord(value)
    if (record === undefined || seen.has(record)) return
    seen.add(record)
    if (typeof record.type === "string") visit(record)
    for (const key of Object.keys(record)) {
      if (key === "type") continue
      step(record[key])
    }
  }
  step(root)
}

/** A JSX element's name: `Combobox`, `Combobox.Input`. */
const jsxNameOf = (value: unknown): string | undefined => {
  const record = asRecord(value)
  if (record === undefined) return undefined
  if (record.type === "JSXMemberExpression") {
    const object = jsxNameOf(record.object)
    const property = jsxNameOf(record.property)
    return object !== undefined && property !== undefined ? `${object}.${property}` : undefined
  }
  return nameOf(record)
}

/** The name a call is made under, for the `use*` hook set. */
const calleeNameOf = (value: unknown): string | undefined => {
  const record = asRecord(value)
  if (record === undefined) return undefined
  return record.type === "MemberExpression" ? calleeNameOf(record.property) : nameOf(record)
}

/** Collect the names a binding pattern introduces: `{ a, b: c, ...rest }` → a, b, rest. */
const collectBindingNames = (value: unknown, into: Set<string>): void => {
  const record = asRecord(value)
  if (record === undefined) return
  if (record.type === "Identifier") {
    const name = nameOf(record)
    if (name !== undefined) into.add(name)
    return
  }
  if (record.type === "ObjectPattern") {
    for (const property of asArray(record.properties)) {
      const entry = asRecord(property)
      if (entry === undefined) continue
      if (entry.type === "RestElement") collectBindingNames(entry.argument, into)
      else {
        const name = nameOf(entry.key)
        if (name !== undefined) into.add(name)
      }
    }
  }
}

const collectDeclarationNames = (declaration: Ast, into: Set<string>): void => {
  if (declaration.type === "VariableDeclaration") {
    for (const declarator of asArray(declaration.declarations)) {
      collectBindingNames(asRecord(declarator)?.id, into)
    }
    return
  }
  const name = nameOf(declaration.id)
  if (name !== undefined) into.add(name)
}

const exportsOf = (program: Ast): ReadonlyArray<string> => {
  const names = new Set<string>()
  walk(program, (node) => {
    if (node.type === "ExportDefaultDeclaration") {
      names.add("default")
    } else if (node.type === "ExportNamedDeclaration") {
      const declaration = asRecord(node.declaration)
      if (declaration !== undefined) collectDeclarationNames(declaration, names)
      for (const specifier of asArray(node.specifiers)) {
        const exported = nameOf(asRecord(specifier)?.exported)
        if (exported !== undefined) names.add(exported)
      }
    }
  })
  return [...names].sort(Order.String)
}

/**
 * Declared prop names.
 *
 * v0 reads the destructured first parameter (`function Button({ variant }: Props)`),
 * which is the common case. A component that takes `props: Props` and reads an
 * interface is not yet followed into its type — noted, because the *signature* is what
 * similarity uses and props are carried for completeness.
 */
const propsOf = (program: Ast): ReadonlyArray<string> => {
  const props = new Set<string>()
  walk(program, (node) => {
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const first = asRecord(asArray(node.params)[0])
      if (first !== undefined && first.type === "ObjectPattern") collectBindingNames(first, props)
    }
  })
  return [...props].sort(Order.String)
}

/** The keys of an object literal, skipping spreads and computed properties. */
const objectKeysOf = (object: Ast): ReadonlyArray<string> => {
  const keys: Array<string> = []
  for (const property of asArray(object.properties)) {
    const entry = asRecord(property)
    if (entry === undefined || entry.type !== "Property") continue
    const key = nameOf(entry.key) ?? stringField(entry.key, "value")
    if (key !== undefined) keys.push(key)
  }
  return keys
}

/** Callee names anywhere under a node, deduplicated. */
const calleeNamesIn = (node: Ast): ReadonlyArray<string> => {
  const names = new Set<string>()
  walk(node, (child) => {
    if (child.type !== "CallExpression") return
    const name = calleeNameOf(child.callee)
    if (name !== undefined) names.add(name)
  })
  return [...names].sort(Order.String)
}

/** Whether JSX appears anywhere under a node. A declaration renders, or it does not. */
const rendersIn = (node: Ast): boolean => {
  let renders = false
  walk(node, (child) => {
    if (child.type === "JSXOpeningElement") renders = true
  })
  return renders
}

/** The JSX tag names inside a node, deduplicated. */
const tagsIn = (node: Ast): ReadonlyArray<string> => {
  const tags = new Set<string>()
  walk(node, (child) => {
    if (child.type !== "JSXOpeningElement") return
    const name = jsxNameOf(child.name)
    if (name !== undefined) tags.add(name)
  })
  return [...tags].sort(Order.String)
}

/**
 * A line for an offset, from the newline positions.
 *
 * oxc reports byte offsets, and a report a person cannot open is not a report: a render
 * edge without a line makes the caller grep. Walking the newlines once per file keeps this
 * linear in the source rather than quadratic in the number of JSX elements.
 */
const lineIndex = (text: string): ((offset: number) => number) => {
  const starts: Array<number> = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1)
  }
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((starts[middle] ?? 0) <= offset) low = middle
      else high = middle - 1
    }
    return low + 1
  }
}

/**
 * The module's top-level declarations.
 *
 * A file is not one thing. `settings-context.tsx` declares a context *and* the hook that
 * reads it; `settings-provider.tsx` declares the component that supplies it. Assigning a
 * kind per file forces a lie, so the crawler keeps each declaration and lets the kind
 * query choose.
 */
const declarationsOf = (program: Ast): ReadonlyArray<Declaration> => {
  interface Draft {
    readonly name: string
    readonly kind: Declaration["kind"]
    readonly exported: boolean
    readonly node: Ast
    readonly objectKeys?: ReadonlyArray<string>
  }
  const drafts: Array<Draft> = []
  const exportedNames = new Set<string>()

  const add = (declaration: Ast | undefined, exported: boolean): void => {
    if (declaration === undefined) return
    if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
      const name = nameOf(declaration.id)
      if (name === undefined) return
      drafts.push({
        name,
        kind: declaration.type === "FunctionDeclaration" ? "function" : "class",
        exported,
        node: declaration,
      })
      return
    }
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of asArray(declaration.declarations)) {
        const entry = asRecord(declarator)
        const name = nameOf(entry?.id)
        if (entry === undefined || name === undefined) continue
        const init = asRecord(entry.init)
        const functionLike =
          init !== undefined &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        const objectKeys = init?.type === "ObjectExpression" ? objectKeysOf(init) : undefined
        drafts.push({
          name,
          kind: functionLike ? "function" : "variable",
          exported,
          node: entry,
          ...(objectKeys === undefined ? {} : { objectKeys }),
        })
      }
      return
    }
    if (
      declaration.type === "TSInterfaceDeclaration" ||
      declaration.type === "TSTypeAliasDeclaration" ||
      declaration.type === "TSEnumDeclaration"
    ) {
      const name = nameOf(declaration.id)
      if (name !== undefined) drafts.push({ name, kind: "type", exported, node: declaration })
    }
  }

  for (const statement of asArray(program.body)) {
    const node = asRecord(statement)
    if (node === undefined) continue
    if (node.type === "ExportNamedDeclaration") {
      add(asRecord(node.declaration), true)
      for (const specifier of asArray(node.specifiers)) {
        // The LOCAL name is what marks the declaration; the exported name may be an alias
        // (`export { Badge as default }`). `exportsOf` records the public spelling.
        const local = nameOf(asRecord(specifier)?.local)
        if (local !== undefined) exportedNames.add(local)
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      const declaration = asRecord(node.declaration)
      if (declaration?.type === "Identifier") {
        const name = nameOf(declaration)
        if (name !== undefined) exportedNames.add(name)
      } else if (declaration === undefined) {
        continue
      } else if (
        declaration.type === "ArrowFunctionExpression" ||
        declaration.type === "FunctionExpression"
      ) {
        drafts.push({ name: "default", kind: "function", exported: true, node: declaration })
      } else if (
        declaration.type === "FunctionDeclaration" ||
        declaration.type === "ClassDeclaration" ||
        declaration.type === "VariableDeclaration"
      ) {
        add(declaration, true)
      } else {
        // `export default memo(...)`, `forwardRef(...)`, and similar expressions carry the
        // component inside a call. Keep the expression so `renders` can still see its JSX.
        drafts.push({ name: "default", kind: "variable", exported: true, node: declaration })
      }
    } else {
      add(node, false)
    }
  }

  // `export { Settings }` marks a declaration written above it; it does not repeat it.
  return drafts.map(({ name, kind, exported, node, objectKeys }) => ({
    name,
    kind,
    exported: exported || exportedNames.has(name),
    renders: rendersIn(node),
    calls: calleeNamesIn(node),
    tags: tagsIn(node),
    ...(objectKeys === undefined ? {} : { objectKeys }),
  }))
}

/**
 * The local names each import statement binds, with its specifier.
 *
 * A namespace binding is deliberately dropped: `import * as UI from "./ui"` then `<UI.Button>`
 * names an export of a barrel, not the barrel part, and guessing that a member expression
 * means its module is the one resolution this pass must not fake. Those tags stay in `tags`
 * unresolved rather than becoming a wrong edge.
 */
const importEdgesOf = (
  statements: ReadonlyArray<{
    readonly moduleRequest: { readonly value: string }
    readonly entries: ReadonlyArray<{
      readonly importName: { readonly kind: string; readonly name: string | null }
      readonly localName: { readonly value: string }
      readonly isType: boolean
    }>
  }>,
): ReadonlyArray<ImportEdge> =>
  statements
    .map((statement) => ({
      specifier: statement.moduleRequest.value,
      bindings: statement.entries
        .filter(
          (entry) =>
            !entry.isType &&
            entry.importName.kind !== "NamespaceObject" &&
            entry.localName.value !== "",
        )
        .map((entry) => entry.localName.value),
    }))
    .filter((edge) => edge.bindings.length > 0)

/**
 * The parser dialect for a file, by extension.
 *
 * `.js` is parsed as JSX: a create-react-app tree puts JSX in plain `.js`, and a parser that
 * assumes TypeScript there reads every component as an empty module. The JSX dialect parses
 * ordinary JavaScript too, so this is a superset rather than a guess.
 */
const langOf = (file: string): "ts" | "tsx" | "jsx" =>
  file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "ts" : "jsx"

/** Parse one module. Parsing never throws: a syntax error yields an empty record. */
export const parseModule = ({
  filename,
  text,
}: {
  readonly filename: string
  readonly text: string
}): SourceModule => {
  const parsed = parseSync(filename, text, { sourceType: "module", lang: langOf(filename) })
  const program = asRecord(parsed.program) ?? {}
  const lineAt = lineIndex(text)
  const tags = new Set<string>()
  const hooks = new Set<string>()
  const renderSites: Array<RenderSite> = []
  const objectKeys = new Map<object, ReadonlyArray<string>>()
  const objectNames = new Map<object, string>()
  let createsContext = false
  walk(program, (node) => {
    if (node.type === "JSXOpeningElement") {
      const name = jsxNameOf(node.name)
      if (name !== undefined) {
        tags.add(name)
        const start = node.start
        if (typeof start === "number") renderSites.push({ tag: name, line: lineAt(start) })
      }
    } else if (node.type === "CallExpression") {
      const name = calleeNameOf(node.callee)
      if (name !== undefined && name.startsWith("use")) hooks.add(name)
      // `createContext` is the composition pattern's one unambiguous structural signal.
      // React itself is spelled `React.createContext`; a repo alias may add a path, so
      // the suffix is the test rather than an exact name.
      if (name === "createContext" || name?.endsWith(".createContext") === true) {
        createsContext = true
      }
    } else if (node.type === "ObjectExpression") {
      objectKeys.set(node, objectKeysOf(node))
    } else if (node.type === "VariableDeclarator") {
      const name = nameOf(node.id)
      const init = asRecord(node.init)
      if (name !== undefined && init?.type === "ObjectExpression") objectNames.set(init, name)
    }
  })
  // Map insertion order is AST order, which is deterministic for the same source.
  const objects: ReadonlyArray<ObjectLiteral> = [...objectKeys].map(([node, keys]) => {
    const name = objectNames.get(node)
    return name === undefined ? { keys } : { name, keys }
  })
  return {
    path: filename,
    exports: exportsOf(program),
    imports: [
      ...new Set([
        ...parsed.module.staticImports.map((entry) => entry.moduleRequest.value),
        // A re-export is an import edge: `export { Button } from "./button.tsx"` makes this
        // module a caller of `button.tsx`. Reading only `staticImports` hides every barrel,
        // and a component re-exported through one reads as an orphan.
        ...parsed.module.staticExports.flatMap((statement) =>
          statement.entries.flatMap((entry) =>
            entry.moduleRequest === null ? [] : [entry.moduleRequest.value],
          ),
        ),
      ]),
    ].sort(Order.String),
    importEdges: importEdgesOf(parsed.module.staticImports),
    tags: [...tags].sort(Order.String),
    renders: renderSites,
    hooks: [...hooks].sort(Order.String),
    props: propsOf(program),
    objects,
    declarations: declarationsOf(program),
    createsContext,
    documented: parsed.comments.some(
      (comment) => comment.type === "Block" && comment.value.startsWith("*"),
    ),
  }
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const

/**
 * A test, story, or declaration is source, but not a part of the UI model.
 *
 * A test imports components to exercise them, so leaving it in would draw test files as
 * components and let a test import count as an owner. A story renders components to catalogue
 * them, and a declaration describes types; neither is a part the app is made of. These are
 * conventions rather than one repository's layout: `*.test.*` / `*.spec.*` suffixes and
 * `__tests__`, `__mocks__`, `__fixtures__`, `test`, and `tests` directories are the shapes
 * every JavaScript tree uses.
 */
const TEST_PATH =
  /(^|\/)(?:__tests__|__mocks__|__fixtures__|tests?)\/|\.(?:test|spec|stories|story|d)\.[^/]+$/u

/** Whether a repository-relative path names a test, story, or declaration file. */
export const isTestPath: Predicate.Predicate<string> = (path) => TEST_PATH.test(path)

/**
 * Every source file under the configured roots, absolute and sorted.
 *
 * @param payload - The root, the configured roots, and the extensions that count as source.
 */
export const listSources = ({
  root,
  roots,
  extensions = SOURCE_EXTENSIONS,
}: {
  readonly root: string
  readonly roots: ReadonlyArray<string>
  readonly extensions?: ReadonlyArray<string>
}): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const found = new Set<string>()
    for (const dir of roots) {
      const absolute = path.resolve(root, dir)
      const names = yield* Effect.orElseSucceed(
        fs.readDirectory(absolute, { recursive: true }),
        () => [] as ReadonlyArray<string>,
      )
      for (const name of names) {
        if (name.includes("node_modules")) continue
        if (isTestPath(name)) continue
        if (extensions.some((extension) => name.endsWith(extension)))
          found.add(path.join(absolute, name))
      }
    }
    return [...found].sort(Order.String)
  })

/** Read and parse every listed file into a module record. */
export const readModules = (
  root: string,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<SourceModule>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const modules: Array<SourceModule> = []
    for (const file of files) {
      const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => undefined)
      if (text === undefined) continue
      const relative = path.relative(root, file).split(path.sep).join("/")
      modules.push(parseModule({ filename: relative, text }))
    }
    return modules
  })
