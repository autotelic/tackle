import { Console, Data, Effect, FileSystem, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import {
  decodeCatalog,
  findParts,
  pagesOfPart,
  partsOfPage,
  projectMenu,
  similarParts,
  similarToSignature,
  type Catalog,
} from "@autotelic/protocol"
import { buildCatalog } from "./catalog.ts"
import type { StalenessResult } from "./check.ts"
import { loadConfig, outputOf } from "./config.ts"
import { parseModule } from "./crawl.ts"
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
import { renderFileSimilar, renderPageView, renderPartView, renderSimilar } from "./render/ask.ts"
import { declarationSkeletonsOf } from "./signature.ts"

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

/**
 * Resolve a query to one part, or say why it is not one.
 *
 * Ambiguity is reported rather than resolved silently: `Button` in two apps is a real
 * question, and picking the alphabetically first path would make the tool's answer depend
 * on a directory name instead of on the tree.
 */
const resolveOne = (
  catalog: Catalog,
  query: string,
): { readonly component: Catalog["components"][number] } | { readonly problem: string } => {
  const matches = findParts(catalog, query)
  const [only] = matches
  if (only === undefined) return { problem: `no part matches "${query}"` }
  if (matches.length > 1) {
    const listed = matches
      .slice(0, 8)
      .map((component) => `  ${component.path}`)
      .join("\n")
    const more = matches.length > 8 ? `\n  … ${matches.length - 8} more` : ""
    return {
      problem: `"${query}" is ${matches.length} parts; pass a path:\n${listed}${more}`,
    }
  }
  return { component: only }
}

/**
 * `ask` — the catalog as questions rather than reports.
 *
 * It reads the artifact, not the tree: the answer a reviewer gets is the answer every
 * consumer of the artifact sees, and `build --check` is what keeps that artifact honest.
 * The queries themselves are `protocol`'s, so `jig menu` answers identically.
 */
const askCommand = Command.make(
  "ask",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root (default: the current directory)."),
      Flag.optional,
    ),
    config: Flag.String("config").pipe(
      Flag.withDescription("Config file, relative to the root (default cutlist.config.json)."),
      Flag.optional,
    ),
    page: Flag.String("page").pipe(
      Flag.withDescription("What does this page render? A route name, id, or path."),
      Flag.optional,
    ),
    part: Flag.String("part").pipe(
      Flag.withDescription("Which pages mount this part? A component name, id, or path."),
      Flag.optional,
    ),
    similar: Flag.String("similar").pipe(
      Flag.withDescription("What already exists like this part? A component name, id, or path."),
      Flag.optional,
    ),
    file: Flag.String("file").pipe(
      Flag.withDescription(
        "Compare a sketch that is not in the catalog yet, per component declaration.",
      ),
      Flag.optional,
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Maximum similar parts per question. Default 8."),
      Flag.withDefault(8),
    ),
    threshold: Flag.Finite("threshold").pipe(
      Flag.withDescription("Minimum similarity to report, 0–1. Default 0.2."),
      Flag.withDefault(0.2),
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("How to render the answer."),
      Flag.withDefault("text"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const cwd = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())
      const settings = yield* loadConfig(
        path.resolve(cwd, Option.getOrUndefined(options.config) ?? "cutlist.config.json"),
      )
      const artifact = path.resolve(cwd, outputOf(settings).catalog)
      const text = yield* Effect.orElseSucceed(fs.readFileString(artifact), () => "")
      const parsed =
        text === ""
          ? undefined
          : yield* Effect.orElseSucceed(
              Effect.sync(() => JSON.parse(text)),
              () => undefined,
            )
      const catalog = parsed === undefined ? undefined : decodeCatalog(parsed)
      if (catalog === undefined) {
        yield* write(`cutlist: no readable catalog at ${artifact}; run \`cutlist build\``)
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }

      const fail = (message: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* write(`cutlist ask: ${message}`)
          yield* Effect.sync(() => {
            process.exitCode = 1
          })
        })

      const pageQuery = Option.getOrUndefined(options.page)
      const partQuery = Option.getOrUndefined(options.part)
      const similarQuery = Option.getOrUndefined(options.similar)
      const fileQuery = Option.getOrUndefined(options.file)
      const asked = [pageQuery, partQuery, similarQuery, fileQuery].filter(
        (value): value is string => value !== undefined,
      )
      if (asked.length === 0) {
        yield* fail(
          "ask one question: --page <route>, --part <component>, --similar <component>, or --file <sketch>",
        )
        return
      }
      if (asked.length > 1) {
        yield* fail("ask one question at a time")
        return
      }

      if (pageQuery !== undefined) {
        const resolved = resolveOne(catalog, pageQuery)
        if ("problem" in resolved) return yield* fail(resolved.problem)
        const view = partsOfPage({ catalog, page: resolved.component.path })
        if (view === undefined) return yield* fail(`no part matches "${pageQuery}"`)
        if (options.format === "json") {
          yield* write(JSON.stringify({ artifact, hash: catalog.hash, page: view }, null, 2))
          return
        }
        yield* write(renderPageView({ catalog, view }))
        return
      }

      if (partQuery !== undefined) {
        const resolved = resolveOne(catalog, partQuery)
        if ("problem" in resolved) return yield* fail(resolved.problem)
        const view = pagesOfPart({ catalog, part: resolved.component.path })
        if (view === undefined) return yield* fail(`no part matches "${partQuery}"`)
        if (options.format === "json") {
          yield* write(JSON.stringify({ artifact, hash: catalog.hash, part: view }, null, 2))
          return
        }
        yield* write(renderPartView({ catalog, view }))
        return
      }

      if (similarQuery !== undefined) {
        const resolved = resolveOne(catalog, similarQuery)
        // A question about something that does not exist yet is the point of this verb:
        // a name still has tokens, and the answer says the evidence is a name.
        const candidates =
          "component" in resolved
            ? similarParts({
                catalog,
                part: resolved.component.path,
                limit: options.limit,
                threshold: options.threshold,
              })
            : similarToSignature({
                catalog,
                signature: [],
                name: similarQuery,
                limit: options.limit,
                threshold: options.threshold,
              })
        if (options.format === "json") {
          yield* write(
            JSON.stringify(
              {
                artifact,
                hash: catalog.hash,
                subject: {
                  query: similarQuery,
                  part: "component" in resolved ? resolved.component.path : null,
                },
                similar: candidates,
              },
              null,
              2,
            ),
          )
          return
        }
        yield* write(renderSimilar({ catalog, subject: similarQuery, candidates }))
        return
      }

      if (fileQuery === undefined) return
      const file = path.resolve(cwd, fileQuery)
      const source = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
      if (source === "") return yield* fail(`could not read ${fileQuery}`)
      const module = parseModule({ filename: path.relative(cwd, file), text: source })
      const groups = declarationSkeletonsOf(module).map((skeleton) => ({
        name: skeleton.name,
        candidates: similarToSignature({
          catalog,
          signature: skeleton.signature,
          name: skeleton.name,
          limit: options.limit,
          threshold: options.threshold,
        }),
      }))
      if (options.format === "json") {
        yield* write(
          JSON.stringify({ artifact, hash: catalog.hash, file: fileQuery, groups }, null, 2),
        )
        return
      }
      yield* write(renderFileSimilar({ catalog, file: fileQuery, groups }))
    }),
).pipe(
  Command.withDescription(
    "Ask the catalog a question: what a page renders, where a part appears, or what a sketch resembles. Reads the committed artifact.",
  ),
  Command.withShortDescription("Ask the catalog a question."),
  Command.withExamples([
    {
      command: "cutlist ask --page projects_.$id._index",
      description: "The parts a route renders, direct and through its children.",
    },
    {
      command: "cutlist ask --part ProjectProgress",
      description: "The routes that mount a part.",
    },
    {
      command: "cutlist ask --similar ProjectProgress",
      description: "Parts that compose the same way, ranked.",
    },
    {
      command: "cutlist ask --file mockups/_shared/proposals.tsx",
      description: "Compare proposed components against the app's catalog, per declaration.",
    },
  ]),
)

const cli = Command.make("cutlist").pipe(
  Command.withDescription(
    "The vocabulary: crawl a UI codebase into a deterministic catalog, a lint manifest, and a menu.",
  ),
  Command.withSubcommands([buildCommand, askCommand]),
)

const program = Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program, { disableErrorReporting: true })
