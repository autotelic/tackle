import { Context, Effect, FileSystem, Layer, Order, Path, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { resolve, sep } from "node:path"
import { TsgoError } from "./schema.ts"
import { looksLikeSource } from "./source.ts"

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface TsgoDiagnostic {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly severity: "error" | "warning"
  readonly code: string
  readonly message: string
}

export interface Interface {
  /** The compiler's view of the project, so joggle indexes what the compiler sees. */
  readonly listFiles: (
    cwd: string,
  ) => Effect.Effect<ReadonlyArray<string>, TsgoError, ChildProcessSpawner>
  /** The compiler's diagnostics, so joggle can carry them in its own report. */
  readonly typecheck: (
    cwd: string,
  ) => Effect.Effect<ReadonlyArray<TsgoDiagnostic>, TsgoError, ChildProcessSpawner>
  /**
   * The whole program as a type trace, written to `outDir`.
   *
   * This is the only way to see what a type RESOLVES to without a fork: the
   * compiler writes its own type graph while it checks, and joggle reads it back.
   * It is the program's view, so it is the program's cost -- the caller decides
   * when a run is worth it.
   */
  readonly generateTrace: (
    cwd: string,
    outDir: string,
  ) => Effect.Effect<void, TsgoError, ChildProcessSpawner>
}

/**
 * The tsgo process surface.
 *
 * `ChildProcessSpawner` is passed through on purpose: running the compiler IS
 * this service's job, and the spawner is the tool it runs with. The requirement
 * is the service's purpose, not a leak.
 *
 * @effect-expect-leaking ChildProcessSpawner
 */
export class Service extends Context.Service<Service, Interface>()("@joggle/Tsgo") {}

/* -------------------------------------------------------------------------- */
/* Implementation                                                              */
/* -------------------------------------------------------------------------- */

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/

const run = (binary: string, args: ReadonlyArray<string>, cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(binary, [...args], { cwd })
      const [stdout, stderr] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: "unbounded" },
      )
      return { stdout, stderr }
    }),
  ).pipe(
    Effect.mapError(
      (cause) =>
        TsgoError.make({
          operation: `tsgo ${args.join(" ")}`,
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    ),
  )

/** A file and the root it is supposed to be under. */
interface RootedFile {
  readonly cwd: string
  readonly file: string
}

/**
 * Whether the compiler's absolute path is inside the analysed root.
 *
 * Resolved on both sides: the root can be relative (it was, at the CLI
 * boundary, before it was normalized), and `startsWith` on raw strings also
 * accepts a sibling whose name merely begins with the root.
 */
const underRoot = ({ cwd, file }: RootedFile): boolean => {
  const root = resolve(cwd)
  const candidate = resolve(file)
  return candidate === root || candidate.startsWith(root + sep)
}

const parseDiagnostics = (output: string): ReadonlyArray<TsgoDiagnostic> => {
  const found: Array<TsgoDiagnostic> = []
  for (const line of output.split(/\r?\n/)) {
    const match = DIAGNOSTIC.exec(line)
    if (match === null) continue
    const file = match[1]
    const lineNumber = match[2]
    const column = match[3]
    const severity = match[4]
    const code = match[5]
    const message = match[6]
    if (
      file === undefined ||
      lineNumber === undefined ||
      column === undefined ||
      severity === undefined ||
      code === undefined ||
      message === undefined
    ) {
      continue
    }
    found.push({
      file,
      line: Number.parseInt(lineNumber, 10),
      column: Number.parseInt(column, 10),
      severity: severity === "error" ? "error" : "warning",
      code,
      message,
    })
  }
  return found
}

const make = (binary: string, path: Path.Path): Interface => {
  const listFiles = Effect.fn("Tsgo.listFiles")(function* (cwd: string) {
    const result = yield* run(binary, ["--listFilesOnly"], cwd)
    const files = new Set<string>()
    for (const raw of result.stdout.split(/\r?\n/)) {
      const file = raw.trim()
      if (!looksLikeSource(file)) continue
      if (!underRoot({ cwd, file })) continue
      files.add(path.resolve(file))
    }
    return [...files].sort(Order.String)
  })

  const typecheck = Effect.fn("Tsgo.typecheck")(function* (cwd: string) {
    const result = yield* run(binary, ["--noEmit", "--pretty", "false"], cwd)
    return parseDiagnostics(`${result.stdout}\n${result.stderr}`)
  })

  const generateTrace = Effect.fn("Tsgo.generateTrace")(function* (cwd: string, outDir: string) {
    yield* run(binary, ["--generateTrace", outDir, "--noEmit"], cwd)
  })

  return Service.of({ listFiles, typecheck, generateTrace })
}

/**
 * The tsgo binary is resolved by the caller because only the caller knows the
 * project root. Everything else about the adapter is a plain subprocess
 * boundary: build args, run, parse, map failures to a typed error.
 */
export const layer = (
  binary: string,
): Layer.Layer<Service, never, Path.Path> =>
  Layer.effect(Service, Effect.map(Path.Path, (path) => make(binary, path)))

/** Resolve the project's own tsgo, falling back to PATH. */
export const layerFromConfig = (
  root: string,
): Layer.Layer<Service, never, ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const local = path.join(root, "node_modules", ".bin", "tsgo")
      const resolved = (yield* Effect.orElseSucceed(fs.exists(local), () => false)) ? local : "tsgo"
      return make(resolved, path)
    }),
  )
