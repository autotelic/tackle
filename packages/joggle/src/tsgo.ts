import { Context, Effect, FileSystem, Layer, Option, Order, Path, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { realpathSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
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

const run = ({
  binary,
  args,
  cwd,
}: {
  readonly binary: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
}) =>
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
          operation: `tsc ${args.join(" ")}`,
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    ),
  )

/** A file and the root it is supposed to be under. */
interface RootedFile {
  readonly cwd: string
  readonly file: string
}

/** A path with every symlink in it resolved, or the lexical path when it does not exist. */
const realPathOf = (file: string): string => {
  // SAFETY: `realpathSync` is the only API that resolves symlinks, and it throws for a
  // path that does not exist yet. The lexical path is the right fallback there: the file is
  // absent either way, so `inRoot` rejects it on the same comparison.
  try {
    return realpathSync(file)
  } catch {
    return resolve(file)
  }
}

/**
 * The compiler's file, expressed under the caller's root, or undefined when it is outside.
 *
 * The comparison happens on REAL paths because the compiler prints the path it resolved:
 * invoked with a cwd of `/tmp/x`, where `/tmp` is a symlink to `/private/tmp`, tsgo lists
 * `/private/tmp/x/src/a.ts`. A lexical `startsWith` on the caller's `/tmp/x` rejected every
 * file, so the run reported "tsgo listed no source files" and analysed nothing -- silently,
 * for anyone whose checkout lives under a symlinked path.
 *
 * The path handed back is in the caller's namespace (`resolve(cwd, relative(realRoot, file))`)
 * so every later comparison -- git's changed files, `path.relative`, the report's locations --
 * keeps using one spelling of the tree.
 */
const inRoot = ({ cwd, file }: RootedFile): Option.Option<string> => {
  const root = realPathOf(cwd)
  const candidate = realPathOf(file)
  if (candidate === root || !candidate.startsWith(root + sep)) return Option.none()
  return Option.some(resolve(cwd, relative(root, candidate)))
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

/**
 * The compiler's arguments, with the content-mapper opt-in in front.
 *
 * `--runExternalCode` is not a performance switch: it lets `tsc` execute the
 * mapper packages a tsconfig names. It is off unless the run asked for it, so a
 * cloned repository cannot make an agent execute code by declaring a mapper.
 */
export const compilerArgs = (
  args: ReadonlyArray<string>,
  runExternalCode: boolean,
): ReadonlyArray<string> => (runExternalCode ? ["--runExternalCode", ...args] : args)

const make = (binary: string, runExternalCode: boolean): Interface => {
  const listFiles = Effect.fn("Tsgo.listFiles")(function* (cwd: string) {
    const result = yield* run({ binary, args: compilerArgs(["--listFilesOnly"], runExternalCode), cwd })
    const files = new Set<string>()
    for (const raw of result.stdout.split(/\r?\n/)) {
      const file = raw.trim()
      if (!looksLikeSource(file)) continue
      const rooted = inRoot({ cwd, file })
      if (Option.isNone(rooted)) continue
      files.add(rooted.value)
    }
    return [...files].sort(Order.String)
  })

  const typecheck = Effect.fn("Tsgo.typecheck")(function* (cwd: string) {
    const result = yield* run({
      binary,
      args: compilerArgs(["--noEmit", "--pretty", "false"], runExternalCode),
      cwd,
    })
    return parseDiagnostics(`${result.stdout}\n${result.stderr}`)
  })

  const generateTrace = Effect.fn("Tsgo.generateTrace")(function* (cwd: string, outDir: string) {
    yield* run({
      binary,
      args: compilerArgs(["--generateTrace", outDir, "--noEmit"], runExternalCode),
      cwd,
    })
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
  options: { readonly runExternalCode?: boolean | undefined } = {},
): Layer.Layer<Service, never, Path.Path> =>
  Layer.effect(
    Service,
    Effect.map(Path.Path, () => make(binary, options.runExternalCode ?? false)),
  )

/** Resolve the project's own compiler, falling back to PATH. */
export const layerFromConfig = (
  root: string,
  options: { readonly runExternalCode?: boolean | undefined } = {},
): Layer.Layer<Service, never, ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const local = path.join(root, "node_modules", ".bin", "tsc")
      const resolved = (yield* Effect.orElseSucceed(fs.exists(local), () => false)) ? local : "tsc"
      return make(resolved, options.runExternalCode ?? false)
    }),
  )
