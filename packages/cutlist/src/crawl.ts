import { Effect, FileSystem, Order, Path } from "effect"
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

/** One parsed module, reduced to what the catalog needs. */
export interface SourceModule {
  /** Repository-relative, forward-slashed. */
  readonly path: string
  readonly exports: ReadonlyArray<string>
  readonly imports: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  readonly hooks: ReadonlyArray<string>
  readonly props: ReadonlyArray<string>
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

/** The parser dialect for a file, by extension. */
const langOf = (file: string): "ts" | "tsx" | "js" | "jsx" =>
  file.endsWith(".tsx") || file.endsWith(".jsx") ? (file.endsWith(".jsx") ? "jsx" : "tsx") : "ts"

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
  const tags = new Set<string>()
  const hooks = new Set<string>()
  walk(program, (node) => {
    if (node.type === "JSXOpeningElement") {
      const name = jsxNameOf(node.name)
      if (name !== undefined) tags.add(name)
    } else if (node.type === "CallExpression") {
      const name = calleeNameOf(node.callee)
      if (name !== undefined && name.startsWith("use")) hooks.add(name)
    }
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
    tags: [...tags].sort(Order.String),
    hooks: [...hooks].sort(Order.String),
    props: propsOf(program),
    documented: parsed.comments.some(
      (comment) => comment.type === "Block" && comment.value.startsWith("*"),
    ),
  }
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const

/** Every source file under the configured roots, absolute and sorted. */
export const listSources = (
  root: string,
  roots: ReadonlyArray<string>,
  extensions: ReadonlyArray<string> = SOURCE_EXTENSIONS,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
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
