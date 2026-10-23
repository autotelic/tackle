import { Console, Data, Effect, FileSystem, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { projectMenu } from "@autotelic/protocol"
import { buildCatalog } from "./catalog.ts"
import type { StalenessResult } from "./check.ts"
import { loadConfig, outputOf } from "./config.ts"
import { readIntent, validateIntent } from "./intent.ts"
import { compareOutput, outputsOf, type Renderings } from "./outputs.ts"
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
        "Fail when a committed rendering (catalog, menu, manifest, …) is stale, instead of writing.",
      ),
      Flag.withDefault(false),
    ),
    timing: Flag.Boolean("timing").pipe(
      Flag.withDescription("Print how long the crawl, the renderings, and the gate took."),
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
      const startedAt = yield* Effect.sync(() => performance.now())
      const catalog = yield* buildCatalog(cwd, settings)
      const crawledAt = yield* Effect.sync(() => performance.now())
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

      // Diagrams are opt-in: an absent path means the projection is not rendered at all,
      // so a repo that does not ask does not pay for the SVG pass or commit the bytes.
      const diagramsDirectory = output.diagrams
      const diagrams =
        diagramsDirectory === undefined
          ? []
          : yield* Effect.try({
              try: () => renderDiagrams(catalog),
              catch: (cause) =>
                new DiagramError({
                  detail: cause instanceof Error ? cause.message : String(cause),
                }),
            })
      const diagramFiles: ReadonlyArray<readonly [string, string]> =
        diagramsDirectory === undefined
          ? []
          : [
              ...diagrams.flatMap((diagram) => [
                [`${diagramsDirectory}/${diagram.name}.mmd`, diagram.mermaid] as const,
                [`${diagramsDirectory}/${diagram.name}.svg`, diagram.svg] as const,
              ]),
              // The index is the macro reading, and part of the artifact: a `--check` that
              // did not compare it would let the table drift from the panels it describes.
              [`${diagramsDirectory}/README.md`, renderDiagramIndex(diagrams)] as const,
            ]

      const renderings: Renderings = {
        catalog: renderCatalog(catalog),
        manifest: renderManifest(catalog, intent.byName),
        menuJson: renderMenuJson(menu),
        menu: renderMenu(menu),
        patterns: renderPatterns(patterns),
        patternsJson: renderPatternsJson(patterns),
        recipes: renderRecipes(recipes),
        recipesJson: renderRecipesJson(recipes),
        hooks: renderHooks(catalog),
        tokens: renderTokens(catalog),
        diagrams: diagramFiles,
      }
      const outputs = outputsOf({ output, renderings, catalogHash: catalog.hash, menu })
      const renderedAt = yield* Effect.sync(() => performance.now())

      if (config.check) {
        const results: Array<readonly [string, StalenessResult]> = []
        for (const file of outputs) {
          results.push([
            file.file,
            yield* compareOutput({ ...file, file: path.resolve(cwd, file.file) }),
          ])
        }
        const comparedAt = yield* Effect.sync(() => performance.now())
        if (config.timing) {
          yield* write(
            `cutlist: timing crawl ${Math.round(crawledAt - startedAt)}ms, render ${Math.round(renderedAt - crawledAt)}ms, compare ${Math.round(comparedAt - renderedAt)}ms`,
          )
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

      for (const file of outputs) {
        const absolute = path.resolve(cwd, file.file)
        yield* Effect.orElseSucceed(
          fs.makeDirectory(path.dirname(absolute), { recursive: true }),
          () => undefined,
        )
        yield* fs.writeFileString(absolute, file.text)
      }
      const writtenAt = yield* Effect.sync(() => performance.now())
      if (config.timing) {
        yield* write(
          `cutlist: timing crawl ${Math.round(crawledAt - startedAt)}ms, render ${Math.round(renderedAt - crawledAt)}ms, write ${Math.round(writtenAt - renderedAt)}ms`,
        )
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
        `cutlist: wrote ${outputs.length} files; ${catalog.components.length} components, ${catalog.duplicates.length} duplicate candidates, ${catalog.clusters?.length ?? 0} clusters, ${catalog.orphans.length} orphans`,
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
    "Crawl the repo and render the catalog, the menu, the pattern language, the recipes, the lint manifest, and the token vocabulary (diagrams when `output.diagrams` is set).",
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
