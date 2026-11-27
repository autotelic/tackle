import { arrayOf, isRecord, str } from "./decode.ts"

/*
 * The dependency surface: the exports a repository's installed packages already offer.
 *
 * This is a derived record, like the catalog: `joggle surface build` reads each direct
 * dependency's one type declaration and writes the names here, and a rule reads the file.
 * It is deliberately shallow. The implementation source is never parsed, transitive
 * dependencies are never walked, and nothing here is typechecked: the question is only
 * whether a name is on offer, not what its body does.
 *
 * A surface is machine-local because it describes one checkout's node_modules. A stale
 * one must degrade to an empty one, never to a false finding, so every reader below is
 * more tolerant than the writer's schema.
 */

/** The surface's format version. A change to the shape is a new lexicon name. */
export const SURFACE_VERSION = 1 as const

/** What an exported declaration is, in the same vocabulary the workspace uses. */
export type SurfaceKind = "function" | "const" | "class" | "type" | "interface" | "enum"

const SURFACE_KINDS: ReadonlyArray<SurfaceKind> = [
  "function",
  "const",
  "class",
  "type",
  "interface",
  "enum",
]

/** One exported declaration, as its dependency's type file spells it. */
export interface SurfaceExport {
  readonly name: string
  /** `root` for the package's main type file, or the re-exported subpath. */
  readonly module: string
  readonly kind: SurfaceKind
  /** The declaration text, bounded by the builder so the record stays small. */
  readonly signature: string
  /** The first line of the declaration's JSDoc, when it has one. */
  readonly doc?: string
}

/** One direct dependency's surface. */
export interface SurfacePackage {
  readonly name: string
  readonly version: string
  readonly exports: ReadonlyArray<SurfaceExport>
}

/** The whole record. */
export interface Surface {
  readonly version: typeof SURFACE_VERSION
  readonly packages: ReadonlyArray<SurfacePackage>
}

/**
 * The reference a surface file carries.
 *
 * A surface is machine-local and never committed, so it does not join the lexicon
 * registry; the reference still names what it is so a reader can tell one from another.
 */
export interface SurfaceRef {
  readonly name: "surface"
  readonly version: number
}

/** A reference to the current surface format. */
export const surfaceRef = (): SurfaceRef => ({ name: "surface", version: SURFACE_VERSION })

/** A surface with nothing on offer. What a malformed or missing file means. */
export const emptySurface = (): Surface => ({
  version: SURFACE_VERSION,
  packages: [],
})

/** Read one exported declaration, or `undefined` when it is not one. */
export const decodeSurfaceExport = (value: unknown): SurfaceExport | undefined => {
  if (!isRecord(value)) return undefined
  const name = str(value.name)
  const module = str(value.module)
  const signature = str(value.signature)
  const kind =
    typeof value.kind === "string" && (SURFACE_KINDS as ReadonlyArray<string>).includes(value.kind)
      ? (value.kind as SurfaceKind)
      : undefined
  if (name === undefined || module === undefined || signature === undefined || kind === undefined) {
    return undefined
  }
  const doc = str(value.doc)
  return {
    name,
    module,
    kind,
    signature,
    ...(doc === undefined ? {} : { doc }),
  }
}

/** Read one package's surface, or `undefined` when it is not one. */
export const decodeSurfacePackage = (value: unknown): SurfacePackage | undefined => {
  if (!isRecord(value)) return undefined
  const name = str(value.name)
  const version = str(value.version)
  const exports = arrayOf(value.exports, decodeSurfaceExport)
  if (name === undefined || version === undefined || exports === undefined) return undefined
  return { name, version, exports }
}

/**
 * Read a surface, or an empty one when the record is malformed.
 *
 * The caller is a rule deciding whether a dependency already offers a primitive, so a
 * corrupt file has to read as "nothing is known" rather than as "nothing is offered";
 * the rule turns that into a note, which is the honest answer.
 */
export const decodeSurface = (value: unknown): Surface => {
  if (!isRecord(value) || value.version !== SURFACE_VERSION) return emptySurface()
  const packages = arrayOf(value.packages, decodeSurfacePackage)
  if (packages === undefined) return emptySurface()
  return { version: SURFACE_VERSION, packages }
}
