import { Effect, FileSystem, Path } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ChildProcess } from "effect/process"

/**
 * Publish, and then believe the registry rather than the command.
 *
 * pnpm's trusted-publishing path is STAGED: it answers 2xx and prints "published
 * successfully" while the version is only staged. A rerun then either completes it or
 * fails with 403 "cannot publish over the previously published versions", depending on
 * whether the stage became visible between the two attempts. Both have happened on this
 * repository, and both left a red workflow after a release that was actually fine.
 *
 * So this does what PUBLISHING.md tells a person to do by hand: run the publish, then
 * read the registry. A failed publish is tolerated only when every local version is
 * already there; a successful publish is retried once when a version is not visible yet,
 * because the registry can lag a few seconds behind the upload. The exit code describes
 * the packages, not the publisher's mood.
 */

const REGISTRY = "https://registry.npmjs.org"

interface Manifest {
  readonly name: string
  readonly version: string
}

/** Run a command with its own output, and answer its exit code. */
const run = (
  root: string,
  command: string,
  args: ReadonlyArray<string>,
): Effect.Effect<number, never, never> =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make(command, [...args], {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    return Number(yield* handle.exitCode)
  }).pipe(
    // A command handle is a scoped resource; without this the spawn fails with
    // "Service not found: effect/Scope" before it starts.
    Effect.scoped,
    Effect.orElseSucceed(() => 1),
  )

/** Every package this repository publishes, read from the tree rather than assumed. */
const published = (
  root: string,
): Effect.Effect<ReadonlyArray<Manifest>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const entries = yield* fs
      .readDirectory(path.join(root, "packages"))
      .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
    const manifests: Array<Manifest> = []
    for (const entry of entries) {
      const file = path.join(root, "packages", entry, "package.json")
      const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
      const manifest = yield* Effect.try(() => JSON.parse(text) as Record<string, unknown>).pipe(
        Effect.orElseSucceed(() => ({})),
      )
      const name = typeof manifest["name"] === "string" ? manifest["name"] : undefined
      const version = typeof manifest["version"] === "string" ? manifest["version"] : undefined
      if (manifest["private"] === true || name === undefined || version === undefined) continue
      manifests.push({ name, version })
    }
    return manifests
  })

/** Whether the registry has this exact version, not merely the package. */
const onRegistry = (manifest: Manifest): Effect.Effect<boolean> =>
  Effect.tryPromise(async () => {
    const response = await fetch(REGISTRY + "/" + manifest.name.replace("/", "%2f"))
    if (!response.ok) return false
    const document = (await response.json()) as {
      readonly versions?: Readonly<Record<string, unknown>>
    }
    return document.versions?.[manifest.version] !== undefined
  }).pipe(Effect.orElseSucceed(() => false))

/** The packages whose local version the registry does not have. */
const missing = (manifests: ReadonlyArray<Manifest>): Effect.Effect<ReadonlyArray<Manifest>> =>
  Effect.gen(function* () {
    const checked = yield* Effect.forEach(manifests, (manifest) =>
      Effect.map(onRegistry(manifest), (there) => ({ manifest, there })),
    )
    return checked.filter((entry) => !entry.there).map((entry) => entry.manifest)
  })

/**
 * Wait for the registry to catch up, rather than assuming the first answer is final.
 *
 * A staged upload and a just-finished publish both look "absent" for a few seconds; the
 * difference is that the first stays absent and the second does not.
 */
const settled = (
  manifests: ReadonlyArray<Manifest>,
  attempts: number,
): Effect.Effect<ReadonlyArray<Manifest>> =>
  Effect.gen(function* () {
    let absent = yield* missing(manifests)
    for (let round = 1; round < attempts && absent.length > 0; round += 1) {
      // Staged versions can take a couple of minutes to become visible; a shorter wait
      // reads a healthy stage as a failed release, which is how this workflow went red
      // twice on a publish that was actually fine.
      yield* Effect.sleep("10 seconds")
      absent = yield* missing(manifests)
    }
    return absent
  })

const report = (absent: ReadonlyArray<Manifest>): Effect.Effect<void> =>
  Effect.sync(() => {
    for (const manifest of absent) {
      console.error("release: still missing " + manifest.name + "@" + manifest.version)
    }
  })

/** The whole release: build, publish, then let the registry decide. */
const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = path.resolve(import.meta.dirname, "..")
  const checkOnly = process.argv.includes("--check")
  const manifests = yield* published(root)

  if (checkOnly) {
    const absent = yield* missing(manifests)
    if (absent.length === 0) {
      yield* Effect.sync(() => console.log("release: every local version is on the registry"))
    } else {
      yield* report(absent)
    }
    if (absent.length > 0)
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
    return
  }

  const built = yield* run(root, "pnpm", ["build"])
  if (built !== 0) {
    yield* Effect.sync(() => {
      process.exitCode = built
    })
    return
  }

  const status = yield* run(root, "pnpm", ["exec", "changeset", "publish"])
  // A staged publish reports success and a rerun reports 403; neither is authoritative,
  // so a failure gets no more patience than a success does.
  let absent = yield* settled(manifests, status === 0 ? 6 : 1)
  if (absent.length > 0 && status === 0) {
    yield* Effect.sync(() =>
      console.log(
        "release: " +
          absent.map((manifest) => manifest.name + "@" + manifest.version).join(", ") +
          " not visible yet; retrying",
      ),
    )
    yield* run(root, "pnpm", ["exec", "changeset", "publish"])
    absent = yield* settled(manifests, 18)
  }

  if (absent.length > 0) {
    yield* report(absent)
    yield* Effect.sync(() => {
      process.exitCode = 1
    })
    return
  }
  yield* Effect.sync(() => console.log("release: every local version is on the registry"))
})

NodeRuntime.runMain(Effect.provide(program, NodeServices.layer), { disableErrorReporting: true })
