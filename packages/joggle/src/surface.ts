import { Effect, FileSystem, Path } from "effect"
import { parseSync } from "oxc-parser"
import {
  SURFACE_VERSION,
  isRecord,
  type Surface,
  type SurfaceExport,
  type SurfaceKind,
  type SurfacePackage,
} from "@autotelic/protocol"

/*
 * Build the dependency surface: the names a repository's direct dependencies export.
 *
 * One type file per dependency and nothing else. Reading implementation source would
 * turn this into a second, worse typechecker; walking transitive dependencies would
 * answer a question about software this repository did not choose. The surface is
 * deliberately a list of names, so the rule that reads it can say "this export is
 * imported nowhere" without pretending to know what the export's body does.
 */

/** A package that had no readable type file, and why. Counted rather than hidden. */
export interface SurfaceSkip {
  readonly name: string
  readonly reason: string
}

/** A built surface, with the packages the build could not read. */
export interface BuiltSurface {
  readonly surface: Surface
  readonly skipped: ReadonlyArray<SurfaceSkip>
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const

const stringAt = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const nameAt = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined
  return stringAt(value["name"]) ?? stringAt(value["value"])
}

/** The declaration file beside a runtime entry, when the manifest names only the runtime one. */
const declarationBeside = (runtime: string): string | undefined => {
  if (/\.d\.[cm]?ts$/u.test(runtime)) return runtime
  if (!/\.(?:[cm]?js)$/u.test(runtime)) return undefined
  return runtime.replace(/\.(?:[cm]?js)$/u, ".d.ts")
}

/** The types entry a manifest names, if it names one. */
const typesEntryOf = (manifest: Record<string, unknown>): string | undefined => {
  const direct = stringAt(manifest["types"]) ?? stringAt(manifest["typings"])
  if (direct !== undefined) return direct
  const exported = manifest["exports"]
  if (isRecord(exported)) {
    const root = exported["."]
    if (typeof root === "string") {
      const beside = declarationBeside(root)
      if (beside !== undefined) return beside
    }
    if (isRecord(root)) {
      const types = root["types"]
      if (typeof types === "string") return types
      if (isRecord(types)) {
        const nested = stringAt(types["import"]) ?? stringAt(types["default"])
        if (nested !== undefined) return nested
      }
      const runtime = stringAt(root["import"]) ?? stringAt(root["default"])
      const beside = runtime === undefined ? undefined : declarationBeside(runtime)
      if (beside !== undefined) return beside
    }
  }
  const main = stringAt(manifest["main"])
  return main === undefined ? undefined : declarationBeside(main)
}

const isDeclarationFile = (file: string): boolean => /\.d\.[cm]?ts$/u.test(file)

const firstDocLine = (comment: string): string | undefined => {
  for (const line of comment.split("\n")) {
    const cleaned = line.replace(/^\s*\*+\s?/u, "").trim()
    if (cleaned !== "") return cleaned
  }
  return undefined
}

interface LocalDeclaration {
  readonly name: string
  readonly kind: SurfaceKind
  readonly signature: string
  readonly doc: string | undefined
}

interface ParsedDeclaration {
  readonly exports: ReadonlyArray<SurfaceExport>
}

const kindOfDeclaration = (type: string): SurfaceKind | undefined => {
  switch (type) {
    case "FunctionDeclaration":
      return "function"
    case "ClassDeclaration":
    case "ClassExpression":
      return "class"
    case "TSInterfaceDeclaration":
      return "interface"
    case "TSTypeAliasDeclaration":
      return "type"
    case "TSEnumDeclaration":
      return "enum"
    case "VariableDeclaration":
      return "const"
    default:
      return undefined
  }
}

const moduleOfSpecifier = (specifier: string): string =>
  specifier
    .replace(/^\.\//u, "")
    .replace(/\.d\.[cm]?ts$/u, "")
    .replace(/\.(?:[cm]?js)$/u, "")

/** Collect the exported declarations of one `.d.ts`, with a bounded signature and first doc line. */
const declarationsIn = (file: string, text: string): ParsedDeclaration => {
  const parsed = parseSync(file, text, { sourceType: "module", lang: "ts" })
  const comments = parsed.comments.map((comment) => ({
    start: comment.start,
    end: comment.end,
    value: comment.value,
  }))
  const docFor = (from: number): string | undefined => {
    let best: { start: number; end: number; value: string } | undefined
    for (const comment of comments) {
      if (comment.end > from) continue
      if (text.slice(comment.end, from).trim() !== "") continue
      if (best === undefined || comment.end > best.end) best = comment
    }
    return best === undefined ? undefined : firstDocLine(best.value)
  }

  const locals = new Map<string, LocalDeclaration>()
  const direct: Array<SurfaceExport> = []
  const reexported: Array<{ exported: string; local: string; module: string; signature: string; kind: SurfaceKind }> = []

  const remember = (
    name: string,
    kind: SurfaceKind,
    node: Record<string, unknown>,
    exported: boolean,
  ): void => {
    const start = node["start"]
    const end = node["end"]
    if (typeof start !== "number" || typeof end !== "number") return
    const signature = text.slice(start, Math.min(end, start + 400))
    const declaration: LocalDeclaration = {
      name,
      kind,
      signature,
      doc: docFor(start),
    }
    if (!locals.has(name)) locals.set(name, declaration)
    if (!exported) return
    if (direct.some((entry) => entry.name === name && entry.module === "root")) return
    direct.push({
      name,
      module: "root",
      kind,
      signature,
      ...(declaration.doc === undefined ? {} : { doc: declaration.doc }),
    })
  }

  const fromDeclaration = (
    declaration: unknown,
    exported: boolean,
    exportedName?: string,
  ): void => {
    if (!isRecord(declaration)) return
    const type = stringAt(declaration["type"])
    if (type === undefined) return
    if (type === "VariableDeclaration") {
      const declarations = declaration["declarations"]
      if (!Array.isArray(declarations)) return
      for (const declarator of declarations) {
        if (!isRecord(declarator)) continue
        const id = declarator["id"]
        const name = nameAt(id)
        if (name === undefined) continue
        remember(exportedName ?? name, "const", declarator, exported)
      }
      return
    }
    const kind = kindOfDeclaration(type)
    if (kind === undefined) return
    const id = declaration["id"]
    const name = nameAt(id)
    if (name === undefined) return
    remember(exportedName ?? name, kind, declaration, exported)
  }

  const body = parsed.program.body
  for (const statement of body) {
    if (!isRecord(statement)) continue
    const type = statement["type"]
    if (type === "ExportNamedDeclaration") {
      const declaration = statement["declaration"]
      if (isRecord(declaration)) {
        fromDeclaration(declaration, true)
      }
      const source = statement["source"]
      const sourceValue = isRecord(source) ? stringAt(source["value"]) : undefined
      const specifiers = statement["specifiers"]
      if (!Array.isArray(specifiers)) continue
      for (const specifier of specifiers) {
        if (!isRecord(specifier)) continue
        const exported = nameAt(specifier["exported"]) ?? nameAt(specifier["local"])
        const local = nameAt(specifier["local"]) ?? exported
        if (exported === undefined || local === undefined) continue
        const start = specifier["start"]
        const end = specifier["end"]
        const signature =
          typeof start === "number" && typeof end === "number"
            ? text.slice(start, Math.min(end, start + 400))
            : local
        const localDeclaration = locals.get(local)
        const kind =
          localDeclaration?.kind ??
          (stringAt(specifier["exportKind"]) === "type" ? "type" : "const")
        reexported.push({
          exported,
          local,
          module: sourceValue === undefined ? "root" : moduleOfSpecifier(sourceValue),
          signature: localDeclaration?.signature ?? signature,
          kind,
        })
      }
      continue
    }
    if (type === "ExportDefaultDeclaration") {
      fromDeclaration(statement["declaration"], true, "default")
      continue
    }
    if (type === "ExportAllDeclaration") {
      const exported = nameAt(statement["exported"])
      const source = statement["source"]
      const sourceValue = isRecord(source) ? stringAt(source["value"]) : undefined
      if (exported !== undefined && sourceValue !== undefined) {
        const start = statement["start"]
        const end = statement["end"]
        reexported.push({
          exported,
          local: exported,
          module: moduleOfSpecifier(sourceValue),
          signature:
            typeof start === "number" && typeof end === "number"
              ? text.slice(start, Math.min(end, start + 400))
              : exported,
          kind: "const",
        })
      }
      continue
    }
    fromDeclaration(statement, false)
  }

  const seen = new Set(direct.map((entry) => entry.module + "\u0000" + entry.name))
  for (const entry of reexported) {
    const key = entry.module + "\u0000" + entry.exported
    if (seen.has(key)) continue
    seen.add(key)
    const localDeclaration = locals.get(entry.local)
    direct.push({
      name: entry.exported,
      module: entry.module,
      kind: entry.kind,
      signature: entry.signature,
      ...(localDeclaration?.doc === undefined ? {} : { doc: localDeclaration.doc }),
    })
  }

  return { exports: direct.sort((left, right) => left.name.localeCompare(right.name)) }
}

/** Read one dependency's manifest, type file and exports. */
const packageSurface = (
  root: string,
  name: string,
): Effect.Effect<SurfacePackage | SurfaceSkip, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = path.join(root, "node_modules", name)
    const manifestFile = path.join(directory, "package.json")
    const exists = yield* Effect.orElseSucceed(fs.exists(manifestFile), () => false)
    if (!exists) return { name, reason: "package.json is not installed" }
    const text = yield* Effect.orElseSucceed(fs.readFileString(manifestFile), () => "")
    let manifest: unknown
    try {
      manifest = JSON.parse(text)
    } catch {
      return { name, reason: "package.json is not readable JSON" }
    }
    if (!isRecord(manifest)) return { name, reason: "package.json is not an object" }
    const version = stringAt(manifest["version"]) ?? ""
    const entry = typesEntryOf(manifest)
    if (entry === undefined) return { name, reason: "no types entry" }
    const file = path.resolve(directory, entry)
    if (!isDeclarationFile(file)) return { name, reason: "types entry is not a .d.ts file" }
    const fileExists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!fileExists) return { name, reason: "types entry does not exist" }
    const declarationText = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    if (declarationText === "") return { name, reason: "types entry is empty" }
    const parsed = declarationsIn(file, declarationText)
    if (parsed.exports.length === 0) return { name, reason: "types entry exports nothing" }
    return { name, version, exports: parsed.exports }
  })

/**
 * Build the surface for a repository's direct dependencies.
 *
 * @param root - the repository root whose `package.json` and `node_modules` are read.
 * @returns the surface and the packages that had no readable type file.
 */
export const buildSurface = ({
  root,
}: {
  readonly root: string
}): Effect.Effect<BuiltSurface, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const manifestFile = path.join(root, "package.json")
    const exists = yield* Effect.orElseSucceed(fs.exists(manifestFile), () => false)
    if (!exists) return { surface: { version: SURFACE_VERSION, packages: [] }, skipped: [] }
    const text = yield* Effect.orElseSucceed(fs.readFileString(manifestFile), () => "")
    let manifest: unknown
    try {
      manifest = JSON.parse(text)
    } catch {
      return { surface: { version: SURFACE_VERSION, packages: [] }, skipped: [] }
    }
    if (!isRecord(manifest)) return { surface: { version: SURFACE_VERSION, packages: [] }, skipped: [] }
    const names = new Set<string>()
    for (const field of DEPENDENCY_FIELDS) {
      const declared = manifest[field]
      if (!isRecord(declared)) continue
      for (const name of Object.keys(declared)) names.add(name)
    }
    const built = yield* Effect.forEach(
      [...names].sort((left, right) => left.localeCompare(right)),
      (name) => packageSurface(root, name),
      { concurrency: 8 },
    )
    const packages: Array<SurfacePackage> = []
    const skipped: Array<SurfaceSkip> = []
    for (const entry of built) {
      if ("exports" in entry) packages.push(entry)
      else skipped.push(entry)
    }
    return {
      surface: { version: SURFACE_VERSION, packages },
      skipped,
    }
  })
