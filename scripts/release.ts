import { Effect, FileSystem, Layer, Path, Schema } from "effect"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ChildProcess } from "effect/process"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import * as HttpClient from "effect/http/HttpClient"

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

/** The fields this script reads from a package manifest; everything else is ignored. */
const PackageManifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
})

/** One command, named rather than positional so a transposed call cannot compile. */
interface CommandRequest {
  readonly root: string
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/**
 * Run a command with its own output, and answer its exit code.
 *
 * A command handle is a scoped resource; without `Effect.scoped` the spawn fails with
 * "Service not found: effect/Scope" before it starts. A spawn that throws is reported as
 * a failed command, because this script's caller only distinguishes zero from non-zero.
 */
const run = ({ root, command, args }: CommandRequest) =>
  Effect.gen(function* () {
    const handle = yield* ChildProcess.make(command, [...args], {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    return Number(yield* handle.exitCode)
  }).pipe(
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
    const none: ReadonlyArray<string> = []
    const entries = yield* fs
      .readDirectory(path.join(root, "packages"))
      .pipe(Effect.orElseSucceed(() => none))
    const manifests: Array<Manifest> = []
    for (const entry of entries) {
      const file = path.join(root, "packages", entry, "package.json")
      const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
      // A directory that is not a package, and a manifest this script cannot read, are both
      // ordinary: `published` answers what it could prove, and the publish step is what
      // reports a missing package.
      const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(PackageManifest))(
        text,
      ).pipe(Effect.orElseSucceed(() => ({})))
      const { name, version } = manifest
      if (manifest.private === true || name === undefined || version === undefined) continue
      manifests.push({ name, version })
    }
    return manifests
  })

/**
 * Whether the registry has this exact version, not merely the package.
 *
 * The question is asked of the VERSION endpoint (`HEAD /<name>/<version>`), which answers 200
 * or 404 and nothing else. Reading the package document instead means decoding a map of every
 * published manifest — a shape npm owns and this script does not — and the first version of
 * this did exactly that with an empty struct as the value type: the request answered 200,
 * every value failed to decode, the field vanished as absent, and a release that had just
 * published reported EVERY package missing. A 409 on the retry, a red workflow, and a
 * published version -- the precise failure this file exists to prevent.
 *
 * A version that is not there is the ordinary answer, not this script's failure: it is the
 * fact the retry loop reads. A request that does not complete also answers false, so the run
 * fails rather than claiming a release it could not verify.
 */
const onRegistry = (manifest: Manifest): Effect.Effect<boolean, never, HttpClient.HttpClient> =>
  HttpClient.head(REGISTRY + "/" + manifest.name.replace("/", "%2f") + "/" + manifest.version).pipe(
    Effect.map((response) => response.status === 200),
    Effect.orElseSucceed(() => false),
  )

/** The packages whose local version the registry does not have. */
const missing = (
  manifests: ReadonlyArray<Manifest>,
): Effect.Effect<ReadonlyArray<Manifest>, never, HttpClient.HttpClient> =>
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
 * difference is that the first stays absent and the second does not. Staged versions can
 * take a couple of minutes to become visible, and a shorter wait reads a healthy stage as a
 * failed release — which is how this workflow went red twice on a publish that was fine.
 */
const settled = (
  manifests: ReadonlyArray<Manifest>,
  attempts: number,
): Effect.Effect<ReadonlyArray<Manifest>, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    let absent = yield* missing(manifests)
    for (let round = 1; round < attempts && absent.length > 0; round += 1) {
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

/**
 * The whole release: build, publish, then let the registry decide.
 *
 * The publish command's exit code is not the registry's answer, in either direction: a
 * staged upload answers success before the version is visible, and re-posting a version
 * that is already staged answers 409 "cannot publish over previously staged version" for a
 * release that is in fact complete. Both happened here, so the command gets a log line and
 * the registry gets the patience — a failure is not treated as a verdict.
 */
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

  const built = yield* run({ root, command: "pnpm", args: ["build"] })
  if (built !== 0) {
    yield* Effect.sync(() => {
      process.exitCode = built
    })
    return
  }

  const status = yield* run({ root, command: "pnpm", args: ["exec", "changeset", "publish"] })
  if (status !== 0) {
    yield* Effect.sync(() =>
      console.log(
        "release: the publish command exited " +
          status +
          "; asking the registry instead of believing it",
      ),
    )
  }
  let absent = yield* settled(manifests, 18)
  if (absent.length > 0) {
    yield* Effect.sync(() =>
      console.log(
        "release: " +
          absent.map((manifest) => manifest.name + "@" + manifest.version).join(", ") +
          " not visible yet; retrying",
      ),
    )
    yield* run({ root, command: "pnpm", args: ["exec", "changeset", "publish"] })
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

NodeRuntime.runMain(
  Effect.provide(program, Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  { disableErrorReporting: true },
)
