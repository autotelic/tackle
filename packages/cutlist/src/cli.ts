import { Console, Effect, FileSystem, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { buildCatalog } from "./catalog.ts"
import { compareCatalog } from "./check.ts"
import { loadConfig, outputOf } from "./config.ts"
import { renderCatalog } from "./render/catalog.ts"
import { renderHooks } from "./render/hooks.ts"
import { renderManifest } from "./render/manifest.ts"
import { renderMenu } from "./render/menu.ts"
import { renderTokens } from "./render/tokens.ts"

/** One report through Effect's Console, newline-normalized so a test can capture it. */
const write = (text: string): Effect.Effect<void> =>
  Console.log(text.endsWith("\n") ? text.slice(0, -1) : text)

const buildCommand = Command.make(
  "build",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root (default: the current directory)."),
      Flag.optional,
    ),
    config: Flag.String("config").pipe(
      Flag.withDescription("Config file, relative to the root (default cutlist.config.json)."),
      Flag.optional,
    ),
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Fail when the committed catalog is stale, instead of writing."),
      Flag.withDefault(false),
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("How to render the model to stdout."),
      Flag.withDefault("text"),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const settings = yield* loadConfig(
        path.resolve(cwd, Option.getOrUndefined(config.config) ?? "cutlist.config.json"),
      )
      const catalog = yield* buildCatalog(cwd, settings)
      const output = outputOf(settings)

      if (config.format === "json") {
        yield* write(JSON.stringify(catalog, null, 2))
        return
      }

      if (config.check) {
        const result = yield* compareCatalog(path.resolve(cwd, output.catalog), catalog)
        if (result.stale) {
          yield* write(
            result.committed === undefined
              ? `${output.catalog} is missing; run \`cutlist build\``
              : `${output.catalog} is stale (committed ${result.committed.slice(0, 12)}, fresh ${result.fresh.slice(0, 12)}); run \`cutlist build\``,
          )
          yield* Effect.sync(() => {
            process.exitCode = 1
          })
          return
        }
        yield* write(`${output.catalog} is up to date (${result.fresh.slice(0, 12)})`)
        return
      }

      const rendered: ReadonlyArray<readonly [string, string]> = [
        [output.catalog, renderCatalog(catalog)],
        [output.manifest, renderManifest(catalog)],
        [output.menu, renderMenu(catalog)],
        [output.hooks, renderHooks(catalog)],
        [output.tokens, renderTokens(catalog)],
      ]
      for (const [relative, text] of rendered) {
        const absolute = path.resolve(cwd, relative)
        yield* Effect.orElseSucceed(
          fs.makeDirectory(path.dirname(absolute), { recursive: true }),
          () => undefined,
        )
        yield* fs.writeFileString(absolute, text)
      }
      yield* write(
        `cutlist: wrote ${rendered.length} files; ${catalog.components.length} components, ${catalog.duplicates.length} duplicate candidates, ${catalog.orphans.length} orphans`,
      )
    }),
).pipe(
  Command.withDescription(
    "Crawl the repo and render the catalog, the lint manifest, and the menu.",
  ),
  Command.withShortDescription("Crawl the repo and render the vocabulary."),
  Command.withExamples([
    { command: "cutlist build", description: "Render every output from the current tree." },
    { command: "cutlist build --check", description: "Fail if the committed catalog is stale." },
  ]),
)

const cli = Command.make("cutlist").pipe(
  Command.withDescription(
    "The vocabulary: crawl a UI codebase into a deterministic catalog, a lint manifest, and a menu.",
  ),
  Command.withSubcommands([buildCommand]),
)

const program = Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program, { disableErrorReporting: true })
