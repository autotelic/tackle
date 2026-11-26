import { Effect, FileSystem, Order, Path, Predicate } from "effect"
import { parseSync } from "oxc-parser"
import type { CatalogDeclaration } from "@autotelic/protocol"

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
export interface Declaration extends CatalogDeclaration {
  /** JSX tags inside the declaration, so one file's declarations can be asked separately. */
  readonly tags: ReadonlyArray<string>
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

/** One oxc static import statement, as far as the crawler reads it. */
interface StaticImport {
  readonly moduleRequest: { readonly value: string }
  readonly entries: ReadonlyArray<{
    readonly importName: { readonly kind: string; readonly name: string | null }
    readonly localName: { readonly value: string }
    readonly isType: boolean
  }>
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
  /**
   * Local views and child components called with the builder; the composition the signature
   * reads. FoldKit's `card(h, …)` and Effect UI's `Collapsible(h, …)` / `NoteComponent.render(h, …)`.
   */
  readonly foldkitCalls?: ReadonlyArray<string>
  /**
   * Effect UI components DEFINED here, by the name written in the definition.
   *
   * `main.ts` is every application's filename; the component it defines is `BoardView`. The
   * name the runtime uses is the `name` option of `Html.component({…})`, so reading the
   * definition is what lets the catalog call the part by it.
   */
  readonly components?: ReadonlyArray<string>
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

/**
 * The HTML element names a builder exposes after `h.`, in FoldKit and in Effect UI.
 *
 * Neither library uses JSX: a view is a function taking the builder and returning
 * `h.div(…)` calls. Recognizing the builder's element vocabulary is what keeps such an app
 * from reading as a directory of empty modules. Attribute builders such as FoldKit's
 * `h.Class` and `h.OnClick` are deliberately absent: they describe an element, they are not
 * one, and counting them would make every styled element a component.
 */
const BUILDER_HTML_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "audio",
  "b",
  "blockquote",
  "br",
  "button",
  "canvas",
  "caption",
  "circle",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "defs",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "g",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "line",
  "link",
  "main",
  "map",
  "mark",
  "menu",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "path",
  "picture",
  "pre",
  "progress",
  "q",
  "rect",
  "s",
  "samp",
  "script",
  "section",
  "select",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
])

/**
 * The element at the head of a builder chain: FoldKit's `h.div([], [ … ])` or Effect UI's
 * `h.div.class("card").children(…)`.
 *
 * Both libraries reach the host elements through a builder object named `h`, and they spell
 * the use differently: FoldKit passes the element's children as arguments, while Effect UI's
 * builder is fluent and the element is the base of a member chain. Recognizing the MEMBER
 * rather than the call is what sees both — in the fluent form no call has the element as its
 * callee, so a call-shaped test reads a whole Effect UI view as an empty module. The
 * vocabulary is the same HTML set either way.
 */
const builderElementTagOf = (node: Ast): string | undefined => {
  if (node.type !== "MemberExpression") return undefined
  const object = asRecord(node.object)
  if (object?.type !== "Identifier" || nameOf(object) !== "h") return undefined
  const tag = nameOf(node.property)
  return tag !== undefined && BUILDER_HTML_TAGS.has(tag) ? tag : undefined
}

/**
 * A child view rendered with the builder: FoldKit's `card(h, props)`, Effect UI's
 * `Collapsible(h, { … })`, or Effect UI's `NoteActivity.render(h, { … })`.
 *
 * Both libraries pass the builder explicitly, so the call itself is the composition edge. A
 * function that never receives the builder is ordinary code, not a render. The member form
 * names the child on the callee's object — `NoteActivity.render` renders `NoteActivity` — so
 * reading the callee's name alone would record "render" and lose the child.
 */
const builderChildNameOf = (node: Ast): string | undefined => {
  if (node.type !== "CallExpression") return undefined
  const callee = asRecord(node.callee)
  if (callee === undefined) return undefined
  const name = callee.type === "MemberExpression" ? nameOf(callee.object) : calleeNameOf(callee)
  if (name === undefined || name === "h") return undefined
  const passesBuilder = asArray(node.arguments).some(
    (argument) => asRecord(argument)?.type === "Identifier" && nameOf(argument) === "h",
  )
  return passesBuilder ? name : undefined
}

/** One render site in a builder-based view: a host element, or a child view given the builder. */
const builderRenderTagOf = (node: Ast): string | undefined =>
  builderElementTagOf(node) ?? builderChildNameOf(node)

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

/** A string-valued property of an object literal, as in `name: "Counter"`. */
const objectStringValueOf = (object: Ast, key: string): string | undefined => {
  for (const property of asArray(object.properties)) {
    const entry = asRecord(property)
    if (entry?.type !== "Property" || nameOf(entry.key) !== key) continue
    const value = stringField(entry.value, "value")
    if (value !== undefined) return value
  }
  return undefined
}

/**
 * The local names bound to Effect UI's HTML module.
 *
 * `Html.component(…)` is the definition the catalog has to see, and an import may rename it
 * (`import { Html as ui } from "@effect/ui/html"`), so the binding is read from the import
 * rather than guessed from the spelling. A namespace import binds the module too.
 */
const effectHtmlBindingsOf = (statements: ReadonlyArray<StaticImport>): ReadonlySet<string> => {
  const bindings = new Set<string>()
  for (const statement of statements) {
    if (statement.moduleRequest.value !== "@effect/ui/html") continue
    for (const entry of statement.entries) {
      if (entry.isType || entry.localName.value === "") continue
      if (entry.importName.kind === "NamespaceObject" || entry.importName.name === "Html") {
        bindings.add(entry.localName.value)
      }
    }
  }
  return bindings
}

/**
 * An Effect UI component definition, `Html.component({ name: "Counter", … }).make({ … })`,
 * and the name written in it.
 *
 * Effect UI has no JSX either: a component is a value, so `const Counter = Html.component(…)
 * .make(…)` is an ordinary variable assignment to a reader that only looks at initialisers,
 * and a view is not a function declaration the way a view block looks in FoldKit. The name
 * comes from the definition's `name` option — not the binding, not the file — because the
 * runtime works out message routing from it and `main.ts` can define `BoardView`.
 */
const effectComponentDefinitionOf = (
  node: Ast,
  htmlBindings: ReadonlySet<string>,
): string | undefined => {
  if (node.type !== "CallExpression") return undefined
  const callee = asRecord(node.callee)
  if (callee?.type !== "MemberExpression" || nameOf(callee.property) !== "component")
    return undefined
  const builder = nameOf(callee.object)
  if (builder === undefined || !htmlBindings.has(builder)) return undefined
  const options = asRecord(asArray(node.arguments)[0])
  if (options?.type !== "ObjectExpression") return undefined
  return objectStringValueOf(options, "name")
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
    if (builderRenderTagOf(child) !== undefined) renders = true
  })
  return renders
}

/** The JSX tag names inside a node, deduplicated. */
const tagsIn = (node: Ast): ReadonlyArray<string> => {
  const tags = new Set<string>()
  walk(node, (child) => {
    if (child.type !== "JSXOpeningElement") {
      const rendered = builderRenderTagOf(child)
      if (rendered !== undefined) tags.add(rendered)
      return
    }
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
const importEdgesOf = (statements: ReadonlyArray<StaticImport>): ReadonlyArray<ImportEdge> =>
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
  const foldkitCalls = new Set<string>()
  const components = new Set<string>()
  const htmlBindings = effectHtmlBindingsOf(parsed.module.staticImports)
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
    } else if (node.type === "MemberExpression") {
      // The element is the base of a builder chain, so it is a member and not a call.
      const element = builderElementTagOf(node)
      const start = node.start
      if (element !== undefined && typeof start === "number") {
        tags.add(element)
        renderSites.push({ tag: element, line: lineAt(start) })
      }
    } else if (node.type === "CallExpression") {
      const name = calleeNameOf(node.callee)
      if (name !== undefined && name.startsWith("use")) hooks.add(name)
      const definition = effectComponentDefinitionOf(node, htmlBindings)
      if (definition !== undefined) components.add(definition)
      const child = builderChildNameOf(node)
      const start = node.start
      if (child !== undefined) {
        // An uppercase child is already a `tag:` fact in the signature; `view:` is the
        // prefix for the lowercase local views both libraries thread the builder through.
        // Recording one composition edge under both prefixes would weigh it double.
        if (!/^[A-Z]/u.test(child)) foldkitCalls.add(child)
        tags.add(child)
        if (typeof start === "number") renderSites.push({ tag: child, line: lineAt(start) })
      }
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
    foldkitCalls: [...foldkitCalls].sort(Order.String),
    components: [...components].sort(Order.String),
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
