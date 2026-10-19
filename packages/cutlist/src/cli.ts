import { Console, Effect, FileSystem, Option, Order, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { projectMenu } from "@autotelic/protocol"
import { buildCatalog } from "./catalog.ts"
import { compareCatalog, compareMenu, compareText, type StalenessResult } from "./check.ts"
import { loadConfig, outputOf } from "./config.ts"
import { readIntent } from "./intent.ts"
import { renderCatalog } from "./render/catalog.ts"
import { renderDiagrams } from "./render/diagram.ts"
import { renderHooks } from "./render/hooks.ts"
import { renderManifest } from "./render/manifest.ts"
import { renderMenu, renderMenuJson } from "./render/menu.ts"
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
      Flag.withDescription(
        "Fail when a committed rendering (catalog, menu, diagram) is stale, instead of writing.",
      ),
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
      const intent = yield* readIntent(cwd, output.intent)

      if (intent.malformed.length > 0) {
        yield* write(
          `cutlist: ${intent.malformed.length} intent file(s) could not be read: ${intent.malformed.join(", ")}`,
        )
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }

      const menu = projectMenu({ catalog, intent: intent.byName })
      const names = new Set(catalog.components.map((component) => component.name))
      const staleIntent = [...intent.byName.keys()]
        .filter((name) => !names.has(name))
        .sort(Order.String)

      if (config.format === "json") {
        yield* write(JSON.stringify(catalog, null, 2))
        return
      }

      const diagramFiles: ReadonlyArray<readonly [string, string]> = renderDiagrams(
        catalog,
      ).flatMap((diagram) => [
        [`${output.diagrams}/${diagram.name}.mmd`, diagram.mermaid] as const,
        [`${output.diagrams}/${diagram.name}.svg`, diagram.svg] as const,
      ])

      if (config.check) {
        const results: Array<readonly [string, StalenessResult]> = [
          [output.catalog, yield* compareCatalog(path.resolve(cwd, output.catalog), catalog)],
          [output.menuJson, yield* compareMenu(path.resolve(cwd, output.menuJson), menu)],
          [output.menu, yield* compareText(path.resolve(cwd, output.menu), renderMenu(menu))],
        ]
        for (const [relative, text] of diagramFiles) {
          results.push([relative, yield* compareText(path.resolve(cwd, relative), text)])
        }
        const stale = results.filter(([, result]) => result.stale)
        if (stale.length > 0 || staleIntent.length > 0) {
          for (const [file, result] of stale) {
            yield* write(
              result.committed === undefined
                ? `${file} is missing; run \`cutlist build\``
                : `${file} is stale (committed ${result.committed.slice(0, 12)}, fresh ${result.fresh.slice(0, 12)}); run \`cutlist build\``,
            )
          }
          if (staleIntent.length > 0) {
            yield* write(
              `intent/ has ${staleIntent.length} file(s) for no existing part: ${staleIntent.join(", ")}`,
            )
          }
          yield* Effect.sync(() => {
            process.exitCode = 1
          })
          return
        }
        yield* write(`cutlist: up to date (${catalog.hash.slice(0, 12)})`)
        return
      }

      const rendered: ReadonlyArray<readonly [string, string]> = [
        [output.catalog, renderCatalog(catalog)],
        [output.manifest, renderManifest(catalog)],
        [output.menuJson, renderMenuJson(menu)],
        [output.menu, renderMenu(menu)],
        [output.hooks, renderHooks(catalog)],
        [output.tokens, renderTokens(catalog)],
        ...diagramFiles,
      ]
      for (const [relative, text] of rendered) {
        const absolute = path.resolve(cwd, relative)
        yield* Effect.orElseSucceed(
          fs.makeDirectory(path.dirname(absolute), { recursive: true }),
          () => undefined,
        )
        yield* fs.writeFileString(absolute, text)
      }
      const staleNote = staleIntent.length === 0 ? "" : `, ${staleIntent.length} stale intent`
      yield* write(
        `cutlist: wrote ${rendered.length} files; ${catalog.components.length} components, ${catalog.duplicates.length} duplicate candidates, ${catalog.orphans.length} orphans${staleNote}`,
      )
    }),
).pipe(
  Command.withDescription(
    "Crawl the repo and render the catalog, the menu, the lint manifest, the graph diagrams, and the token vocabulary.",
  ),
  Command.withShortDescription("Crawl the repo and render the vocabulary."),
  Command.withExamples([
    { command: "cutlist build", description: "Render every output from the current tree." },
    {
      command: "cutlist build --check",
      description: "Fail if a committed rendering is stale.",
    },
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
