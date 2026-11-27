import { Effect, FileSystem, Option, Path } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parseSync } from "oxc-parser"
import {
  SURFACE_VERSION,
  decodeSurface,
  emptySurface,
  int,
  isRecord,
  parseJson,
  str,
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

/** Where `surface build` writes, relative to the workspace root, and the rule reads. */
export const SURFACE_PATH = ".joggle/surface.json"

/**
 * The workspace root a surface path is resolved against.
 *
 * `surface build` and the rule that reads its file must agree on one base, or the
 * build writes under the package directory pnpm happened to start in while the
 * rule looks under the workspace root. The nearest `.git` is the boundary the
 * launcher already walks to, so a nested repository does not borrow its host's
 * surface and a scratch directory does not walk to `/`.
 *
 * @param start - the directory the command was started from.
 * @returns the nearest enclosing repository root, or `start` when there is none.
 */
export const projectRootOf = (start: string): string => {
  const begin = resolve(start)
  let dir = begin
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return begin
    dir = parent
  }
}

/** Where the surface file lives: one expression for the writer and the reader. */
export const surfaceFileOf = ({
  root,
  surfacePath,
}: {
  readonly root: string
  readonly surfacePath: string | undefined
}): string => resolve(root, surfacePath ?? SURFACE_PATH)

/**
 * Where `surface build` writes by default.
 *
 * One function so the writer and the rule cannot drift: both anchor on
 * {@link projectRootOf}, and a test can prove the default output is the path the rule
 * then reads without spawning a command.
 */
export const surfaceOutputOf = ({
  start,
  out,
}: {
  readonly start: string
  readonly out: string | undefined
}): string => {
  const root = projectRootOf(start)
  return out === undefined ? surfaceFileOf({ root, surfacePath: undefined }) : resolve(root, out)
}

/**
 * Read the surface, or an empty one when it is absent or malformed.
 *
 * The reader and `surface build` share {@link surfaceFileOf}, and a corrupt file
 * reads as "nothing is known" so the rule turns it into a note rather than silence.
 */
export const readSurface = ({
  root,
  surfacePath,
}: {
  readonly root: string
  readonly surfacePath: string | undefined
}): Surface => {
  const file = surfaceFileOf({ root, surfacePath })
  if (!existsSync(file)) return emptySurface()
  return decodeSurface(parseJson(readFileSync(file, "utf8")))
}

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"] as const

const nameAt = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined
  return str(value["name"]) ?? str(value["value"])
}

/** The declaration file beside a runtime entry, when the manifest names only the runtime one. */
const declarationBeside = (runtime: string): string | undefined => {
  if (/\.d\.[cm]?ts$/u.test(runtime)) return runtime
  if (!/\.(?:[cm]?js)$/u.test(runtime)) return undefined
  return runtime.replace(/\.(?:[cm]?js)$/u, ".d.ts")
}

/** The types entry a manifest names, if it names one. */
const typesEntryOf = (manifest: Record<string, unknown>): string | undefined => {
  const direct = str(manifest["types"]) ?? str(manifest["typings"])
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
        const nested = str(types["import"]) ?? str(types["default"])
        if (nested !== undefined) return nested
      }
      const runtime = str(root["import"]) ?? str(root["default"])
      const beside = runtime === undefined ? undefined : declarationBeside(runtime)
      if (beside !== undefined) return beside
    }
  }
  const main = str(manifest["main"])
  return main === undefined ? undefined : declarationBeside(main)
}

const firstDocLine = (comment: string): string | undefined => {
  for (const line of comment.split("\n")) {
    const cleaned = line.replace(/^\s*\*+\s?/u, "").trim()
    if (cleaned !== "") return cleaned
  }
  return undefined
}

/**
 * The declaration file a relative specifier names.
 *
 * A root `.d.ts` writes `./Duration.js` or `./Data.ts` even though the file beside it
 * is `Duration.d.ts`; both spellings resolve to the same declaration. Returning
 * undefined for a bare package name keeps the walk inside the dependency's own tree.
 */
const declarationFileOf = ({
  from,
  specifier,
}: {
  readonly from: string
  readonly specifier: string
}): Option.Option<string> => {
  if (!specifier.startsWith(".")) return Option.none()
  const target = resolve(dirname(from), specifier)
  return Option.fromUndefinedOr(
    [
      target,
      target.replace(/\.(?:[cm]?ts)$/u, ".d.ts"),
      target.replace(/\.(?:[cm]?js)$/u, ".d.ts"),
      target + ".d.ts",
    ].find((candidate) => existsSync(candidate)),
  )
}

/**
 * The target's module doc, for a namespace re-export.
 *
 * A root file that says `export * as Duration from "./Duration.ts"` tells a reader
 * nothing about Duration. The judgement rule is shown that signature and asked what
 * the export does, so the target module's own opening comment is the only fact on
 * offer. Following one sibling declaration file is not walking a dependency tree; it
 * is reading the file the re-export names.
 */
const moduleDocOf = ({
  from,
  specifier,
}: {
  readonly from: string
  readonly specifier: string
}): Option.Option<string> =>
  Option.flatMap(
    Option.some(specifier).pipe(Option.filter((relative) => relative.startsWith("."))),
    (relative) => {
      const found = Option.getOrUndefined(declarationFileOf({ from, specifier: relative }))
      return Option.flatMap(Option.fromUndefinedOr(found), (file) => {
        const text = readFileSync(file, "utf8")
        const parsed = parseSync(file, text, { sourceType: "module", lang: "ts" })
        return Option.flatMap(Option.fromUndefinedOr(parsed.comments[0]), (comment) =>
          Option.fromUndefinedOr(firstDocLine(comment.value)),
        )
      })
    },
  )

type LocalDeclaration = Omit<SurfaceExport, "module" | "doc"> & {
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
    .replace(/\.(?:[cm]?ts)$/u, "")
    .replace(/\.(?:[cm]?js)$/u, "")

/** Collect the exported declarations of one `.d.ts`, with a bounded signature and first doc line. */
const declarationsIn = ({
  file,
  text,
  visited = new Set<string>(),
  followStar = true,
}: {
  readonly file: string
  readonly text: string
  /** Declaration files already read in this walk; a cycle stops at the second sight. */
  readonly visited?: Set<string>
  /** Whether a star export may be followed. False in the sibling, so depth is one. */
  readonly followStar?: boolean
}): ParsedDeclaration => {
  visited.add(resolve(file))
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
  const expanded: Array<SurfaceExport> = []
  const reexported: Array<{
    exported: string
    local: string
    module: string
    source: string | undefined
    signature: string
    kind: SurfaceKind
  }> = []

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
    const entry: SurfaceExport =
      declaration.doc === undefined
        ? { name, module: "root", kind, signature }
        : { name, module: "root", kind, signature, doc: declaration.doc }
    direct.push(entry)
  }

  const fromDeclaration = (
    declaration: unknown,
    exported: boolean,
    exportedName: string | undefined,
  ): void => {
    if (!isRecord(declaration)) return
    const type = str(declaration["type"])
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
        fromDeclaration(declaration, true, undefined)
      }
      const source = statement["source"]
      const sourceValue = isRecord(source) ? str(source["value"]) : undefined
      const specifiers = statement["specifiers"]
      if (!Array.isArray(specifiers)) continue
      for (const specifier of specifiers) {
        if (!isRecord(specifier)) continue
        const exported = nameAt(specifier["exported"]) ?? nameAt(specifier["local"])
        const local = nameAt(specifier["local"]) ?? exported
        if (exported === undefined || local === undefined) continue
        const start = int(specifier["start"])
        const end = int(specifier["end"])
        const signature =
          start === undefined || end === undefined
            ? local
            : text.slice(start, Math.min(end, start + 400))
        const localDeclaration = locals.get(local)
        const kind =
          localDeclaration?.kind ??
          (str(specifier["exportKind"]) === "type" ? "type" : "const")
        reexported.push({
          exported,
          local,
          module: sourceValue === undefined ? "root" : moduleOfSpecifier(sourceValue),
          source: sourceValue,
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
      const sourceValue = isRecord(source) ? str(source["value"]) : undefined
      // `export * from "./Duration.js"` is how effect's root exposes most of its API,
      // and a plain star contributed nothing. Read the one sibling declaration file
      // it names and take its exports, tagged with the module the specifier spells.
      // The sibling is parsed with followStar false, so depth is bounded at one; the
      // visited set makes a cycle terminate even if that bound is ever raised.
      if (followStar && sourceValue !== undefined) {
        const target = Option.getOrUndefined(declarationFileOf({ from: file, specifier: sourceValue }))
        if (target !== undefined && !visited.has(resolve(target))) {
          const targetText = readFileSync(target, "utf8")
          const nested = declarationsIn({
            file: target,
            text: targetText,
            visited,
            followStar: false,
          })
          const module = moduleOfSpecifier(sourceValue)
          for (const entry of nested.exports) expanded.push({ ...entry, module })
        }
      }
      if (exported !== undefined && sourceValue !== undefined) {
        const start = int(statement["start"])
        const end = int(statement["end"])
        reexported.push({
          exported,
          local: exported,
          module: moduleOfSpecifier(sourceValue),
          source: sourceValue,
          signature:
            start === undefined || end === undefined
              ? exported
              : text.slice(start, Math.min(end, start + 400)),
          kind: "const",
        })
      }
      continue
    }
    fromDeclaration(statement, false, undefined)
  }

  const seen = new Set(direct.map((entry) => entry.module + "\u0000" + entry.name))
  for (const entry of expanded) {
    const key = entry.module + "\u0000" + entry.name
    if (seen.has(key)) continue
    seen.add(key)
    direct.push(entry)
  }
  for (const entry of reexported) {
    const key = entry.module + "\u0000" + entry.exported
    if (seen.has(key)) continue
    seen.add(key)
    const localDeclaration = locals.get(entry.local)
    const doc =
      localDeclaration?.doc ??
      (entry.source === undefined
        ? undefined
        : Option.getOrUndefined(moduleDocOf({ from: file, specifier: entry.source })))
    const surfaceExport: SurfaceExport =
      doc === undefined
        ? {
            name: entry.exported,
            module: entry.module,
            kind: entry.kind,
            signature: entry.signature,
          }
        : {
            name: entry.exported,
            module: entry.module,
            kind: entry.kind,
            signature: entry.signature,
            doc,
          }
    direct.push(surfaceExport)
  }

  return { exports: direct.sort((left, right) => left.name.localeCompare(right.name)) }
}

/** Read one dependency's manifest, type file and exports. */
const packageSurface = ({
  root,
  name,
}: {
  readonly root: string
  readonly name: string
}): Effect.Effect<SurfacePackage | SurfaceSkip, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = path.join(root, "node_modules", name)
    const manifestFile = path.join(directory, "package.json")
    const exists = yield* Effect.orElseSucceed(fs.exists(manifestFile), () => false)
    if (!exists) return { name, reason: "package.json is not installed" }
    const text = yield* Effect.orElseSucceed(fs.readFileString(manifestFile), () => "")
    const manifest = parseJson(text)
    if (!isRecord(manifest)) return { name, reason: "package.json is not an object" }
    const version = str(manifest["version"]) ?? ""
    const entry = typesEntryOf(manifest)
    if (entry === undefined) return { name, reason: "no types entry" }
    const file = path.resolve(directory, entry)
    if (!/\.d\.[cm]?ts$/u.test(file)) return { name, reason: "types entry is not a .d.ts file" }
    const fileExists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!fileExists) return { name, reason: "types entry does not exist" }
    const declarationText = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    if (declarationText === "") return { name, reason: "types entry is empty" }
    const parsed = declarationsIn({ file, text: declarationText })
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
    const manifest = parseJson(text)
    if (!isRecord(manifest)) return { surface: { version: SURFACE_VERSION, packages: [] }, skipped: [] }
    const names = new Set<string>()
    for (const field of DEPENDENCY_FIELDS) {
      const declared = manifest[field]
      if (!isRecord(declared)) continue
      for (const name of Object.keys(declared)) names.add(name)
    }
    const built = yield* Effect.forEach(
      [...names].sort((left, right) => left.localeCompare(right)),
      (name) => packageSurface({ root, name }),
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
