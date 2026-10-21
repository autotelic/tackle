import { Console, Data, Effect, FileSystem, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { projectMenu } from "@autotelic/protocol"
import { buildCatalog } from "./catalog.ts"
import {
  compareCatalog,
  compareJson,
  compareMenu,
  compareText,
  type StalenessResult,
} from "./check.ts"
import { loadConfig, outputOf } from "./config.ts"
import { readIntent, validateIntent } from "./intent.ts"
import { patternsOf } from "./patterns.ts"
import { renderCatalog } from "./render/catalog.ts"
import { renderDiagramIndex, renderDiagrams } from "./render/diagram.ts"
import { renderHooks } from "./render/hooks.ts"
import { renderManifest } from "./render/manifest.ts"
import { renderMenu, renderMenuJson } from "./render/menu.ts"
import { renderPatterns, renderPatternsJson } from "./render/patterns.ts"
import { recipesOf, renderRecipes, renderRecipesJson } from "./render/recipes.ts"
import { renderTokens } from "./render/tokens.ts"

/** One report through Effect's Console, newline-normalized so a test can capture it. */
const write = (text: string): Effect.Effect<void> =>
  Console.log(text.endsWith("\n") ? text.slice(0, -1) : text)

/**
 * A drawing failure, on the error channel rather than as a thrown `PeleError`.
 *
 * `pele` throws synchronously, and `NodeRuntime.runMain(..., { disableErrorReporting: true })`
 * turns an unhandled throw into a silent exit 1 — which is how a source over the limit looked
 * like `cutlist build` doing nothing. `Effect.try` names the failure, and the handler below
 * prints it: a rendering that cannot be drawn is a report, not an absence.
 */
class DiagramError extends Data.TaggedError("DiagramError")<{
  readonly detail: string
}> {}

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
      const intent = yield* readIntent({ root: cwd, directory: output.intent })

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
      const patterns = patternsOf({ catalog, intent: intent.byName })
      const recipes = recipesOf({ catalog, view: patterns })
      const issues = validateIntent({ byName: intent.byName, components: catalog.components })
      const issueCount = issues.stale.length + issues.unknownTargets.length + issues.stranded.length

      if (config.format === "json") {
        yield* write(JSON.stringify(catalog, null, 2))
        return
      }

      const diagrams = yield* Effect.try({
        try: () => renderDiagrams(catalog),
        catch: (cause) =>
          new DiagramError({
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
      })
      const diagramFiles: ReadonlyArray<readonly [string, string]> = [
        ...diagrams.flatMap((diagram) => [
          [`${output.diagrams}/${diagram.name}.mmd`, diagram.mermaid] as const,
          [`${output.diagrams}/${diagram.name}.svg`, diagram.svg] as const,
        ]),
        // The index is the macro reading, and part of the artifact: a `--check` that did not
        // compare it would let the table drift from the panels it describes.
        [`${output.diagrams}/README.md`, renderDiagramIndex(diagrams)] as const,
      ]

      if (config.check) {
        const results: Array<readonly [string, StalenessResult]> = [
          [
            output.catalog,
            yield* compareCatalog({ file: path.resolve(cwd, output.catalog), fresh: catalog }),
          ],
          [
            output.menuJson,
            yield* compareMenu({ file: path.resolve(cwd, output.menuJson), fresh: menu }),
          ],
          [
            output.menu,
            yield* compareText({
              file: path.resolve(cwd, output.menu),
              fresh: renderMenu(menu),
            }),
          ],
          [
            output.patterns,
            yield* compareText({
              file: path.resolve(cwd, output.patterns),
              fresh: renderPatterns(patterns),
            }),
          ],
          [
            output.patternsJson,
            yield* compareJson({
              file: path.resolve(cwd, output.patternsJson),
              fresh: patterns,
            }),
          ],
          [
            output.recipes,
            yield* compareText({
              file: path.resolve(cwd, output.recipes),
              fresh: renderRecipes(recipes),
            }),
          ],
          [
            output.recipesJson,
            yield* compareJson({
              file: path.resolve(cwd, output.recipesJson),
              fresh: recipes,
            }),
          ],
        ]
        for (const [relative, text] of diagramFiles) {
          results.push([
            relative,
            yield* compareText({ file: path.resolve(cwd, relative), fresh: text }),
          ])
        }
        const stale = results.filter(([, result]) => result.stale)
        if (stale.length > 0 || issueCount > 0) {
          for (const [file, result] of stale) {
            yield* write(
              result.committed === undefined
                ? `${file} is missing; run \`cutlist build\``
                : `${file} is stale (committed ${result.committed.slice(0, 12)}, fresh ${result.fresh.slice(0, 12)}); run \`cutlist build\``,
            )
          }
          if (issues.stale.length > 0) {
            yield* write(
              `intent/ has ${issues.stale.length} file(s) for no existing part: ${issues.stale.join(", ")}`,
            )
          }
          if (issues.unknownTargets.length > 0) {
            yield* write(
              `intent/ points at ${issues.unknownTargets.length} unknown useInstead target(s): ${issues.unknownTargets.join(", ")}`,
            )
          }
          if (issues.stranded.length > 0) {
            yield* write(
              `intent/ marks ${issues.stranded.length} part(s) deprecated without a useInstead target: ${issues.stranded.join(", ")}`,
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
        [output.manifest, renderManifest(catalog, intent.byName)],
        [output.menuJson, renderMenuJson(menu)],
        [output.menu, renderMenu(menu)],
        [output.patterns, renderPatterns(patterns)],
        [output.patternsJson, renderPatternsJson(patterns)],
        [output.recipes, renderRecipes(recipes)],
        [output.recipesJson, renderRecipesJson(recipes)],
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
      if (issues.stale.length > 0) {
        yield* write(
          `cutlist: ${issues.stale.length} intent file(s) name no existing part: ${issues.stale.join(", ")}`,
        )
      }
      if (issues.unknownTargets.length > 0) {
        yield* write(
          `cutlist: ${issues.unknownTargets.length} useInstead target(s) name no existing part: ${issues.unknownTargets.join(", ")}`,
        )
      }
      if (issues.stranded.length > 0) {
        yield* write(
          `cutlist: ${issues.stranded.length} deprecated part(s) have no useInstead target: ${issues.stranded.join(", ")}`,
        )
      }
      yield* write(
        `cutlist: wrote ${rendered.length} files; ${catalog.components.length} components, ${catalog.duplicates.length} duplicate candidates, ${catalog.clusters?.length ?? 0} clusters, ${catalog.orphans.length} orphans`,
      )
    }).pipe(
      Effect.catchTag("DiagramError", (error) =>
        Effect.gen(function* () {
          yield* write(`cutlist: could not draw the diagrams: ${error.detail}`)
          yield* Effect.sync(() => {
            process.exitCode = 1
          })
        }),
      ),
    ),
).pipe(
  Command.withDescription(
    "Crawl the repo and render the catalog, the menu, the pattern language, the recipes, the lint manifest, the graph diagrams, and the token vocabulary.",
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
