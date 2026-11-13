import fc from "fast-check"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import {
  configFor,
  cookbookFor,
  initialise,
  initJson,
  inspectRepo,
  mergeArchitecture,
  onboardingFor,
  summaryFor,
} from "./init.ts"

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect)

type TextFile = readonly [string, string]
type JsonFile = readonly [string, object]

const project = (
  input: {
    readonly text?: ReadonlyArray<TextFile>
    readonly json?: ReadonlyArray<JsonFile>
  },
  bins: ReadonlyArray<string>,
): string => {
  const root = mkdtempSync(join(tmpdir(), "jig-init-"))
  for (const [name, body] of input.text ?? []) {
    const target = join(root, name)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, body)
  }
  for (const [name, body] of input.json ?? []) {
    const target = join(root, name)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, JSON.stringify(body))
  }
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true })
  for (const bin of bins) writeFileSync(join(root, "node_modules", ".bin", bin), "")
  return root
}

const inspect = (root: string) => run(inspectRepo(root).pipe(Effect.provide(NodeServices.layer)))

const initialiseIn = (root: string, options: NonNullable<Parameters<typeof initialise>[1]> = {}) =>
  run(initialise(root, options).pipe(Effect.provide(NodeServices.layer)))

const OXLINT = {
  jsPlugins: [{ name: "plumb", specifier: "@autotelic/plumb" }],
  rules: { "plumb/no-known-value-widening": "error" },
}

describe("mergeArchitecture", () => {
  it("re-drafts the includes and keeps the forbid by layer name", () => {
    const existing = {
      unavailable: "count",
      rules: { "joggle/import-cycle": "error", "joggle/layer-direction": "error" },
      architecture: {
        layers: [
          { name: "domain", include: ["packages/domain/**"], forbid: ["react*", "fastify*"] },
          { name: "legacy", include: ["packages/legacy/**"], forbid: ["react*"] },
          { name: "ui", include: ["services/ui/**"] },
        ],
      },
    }
    const merged = mergeArchitecture({
      existing,
      draft: [
        { name: "domain", include: ["packages/domain/**", "packages/shakti-utils/**"] },
        { name: "ui" },
      ] as ReadonlyArray<{ name: string; include: ReadonlyArray<string> }>,
    })
    const layers = (merged.file.architecture as { layers: ReadonlyArray<Record<string, unknown>> })
      .layers
    // The include set follows the tree; the forbid follows the name a person wrote it against.
    expect(layers[0]).toEqual({
      name: "domain",
      include: ["packages/domain/**", "packages/shakti-utils/**"],
      forbid: ["react*", "fastify*"],
    })
    expect(merged.forbidsKept).toEqual(["domain"])
    // A layer the draft stopped proposing is reported, never dropped in silence: a lost
    // forbid makes layer-purity read 0 on a rule nobody removed.
    expect(merged.forbidsDropped).toEqual(["legacy"])
    // Everything that is not architecture.layers survives untouched.
    expect(merged.file.rules).toEqual(existing.rules)
    expect(merged.file.unavailable).toBe("count")
  })
})

describe("inspectRepo", () => {
  it("finds the package manager, the strict oxlint gate, and the engines it can run", async () => {
    const root = project(
      {
        json: [
          [
            "package.json",
            {
              packageManager: "pnpm@9.10.0",
              scripts: { "lint:errors": "oxlint -c .oxlint-errors.json .", lint: "oxlint ." },
            },
          ],
          ["tsconfig.json", {}],
          [".oxlint-errors.json", OXLINT],
        ],
        text: [
          ["pnpm-workspace.yaml", "packages:\n  - apps/*\n"],
          ["AGENTS.md", "# Agents\n"],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.packageManager).toBe("pnpm")
      expect(profile.facts.has("workspaces")).toBe(true)
      expect(profile.lint.config).toBe(".oxlint-errors.json")
      expect(profile.lint.script).toBe("lint:errors")
      expect(profile.agentDocs).toEqual(["AGENTS.md"])
      expect(profile.engines.map((engine) => engine.id)).toEqual(["plumb", "joggle"])
      expect(profile.engines[0]?.config).toBe(".oxlint-errors.json")
      expect(profile.engines[0]?.args).toEqual(["."])
      expect(profile.gateMode).toBe("touched-files")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not run plumb under an oxlint config that does not load it", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", { rules: { "no-unused-vars": "warn" } }],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.engines.map((engine) => engine.id)).toEqual(["joggle"])
      expect(profile.notes.join("\n")).toContain("does not load @autotelic/plumb")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not run plumb in an eslint repository", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "eslint ." } }],
          ["tsconfig.json", {}],
        ],
        text: [["eslint.config.mjs", "export default []\n"]],
      },
      ["joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.engines.map((engine) => engine.id)).toEqual(["joggle"])
      expect(profile.notes.join("\n")).toContain("eslint")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes joggle's correctness flags, and its own ledger, not just its name", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
      },
      ["joggle"],
    )
    try {
      const profile = await inspect(root)
      const joggle = profile.engines.find((engine) => engine.id === "joggle")
      // A replay is not a look, and an untyped check misses the Effect rules.
      expect(joggle?.config).toBe("joggle.config.json")
      expect(joggle?.args).toEqual([
        "--types",
        "--no-replay",
        "--baseline",
        ".joggle-baseline.json",
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("proposes architecture layers from the workspace, without inventing judgment", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          ["packages/domain/package.json", { name: "@acme/domain" }],
          ["packages/rest/package.json", { name: "@acme/rest" }],
        ],
        text: [["pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n']],
      },
      ["joggle"],
    )
    try {
      await initialiseIn(root)
      const starter = JSON.parse(readFileSync(join(root, "joggle.config.json"), "utf8"))
      // The include set is decidable; the order and the forbid sets are a person's call.
      expect(starter.architecture.layers).toEqual([
        { name: "domain", include: ["packages/domain/**"] },
        { name: "rest", include: ["packages/rest/**"] },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("picks the root that owns the design system, not the first one alphabetically", async () => {
    const colours = (count: number): string =>
      "export default { theme: { extend: { colors: { " +
      Array.from({ length: count }, (_, index) => `c${String(index)}: "#000000"`).join(", ") +
      " } } } }\n"
    const vars = (count: number): string =>
      ":root {\n" +
      Array.from({ length: count }, (_, index) => `  --x-${String(index)}: 1px;`).join("\n") +
      "\n}\n"
    const root = project(
      {
        json: [["package.json", {}]],
        text: [
          ["services/auth-ui/app/components/Button.tsx", "export const Button = () => null\n"],
          ["services/auth-ui/app/tailwind.config.ts", colours(8)],
          ["services/auth-ui/app/app.css", "[data-theme=dark] { --a: 1px; --b: 1px; }\n"],
          ["services/ui/app/components/ui/Button.tsx", "export const Button = () => null\n"],
          ["services/ui/app/tailwind.config.ts", colours(20)],
          ["services/ui/app/tailwind.css", vars(20)],
        ],
      },
      ["cutlist"],
    )
    try {
      await initialiseIn(root, { cutlist: true })
      const config = JSON.parse(readFileSync(join(root, "cutlist.config.json"), "utf8"))
      // auth-ui sorts first and used to win: it has 8 colours and no :root layer.
      expect(config.tokens.from).toBe("services/ui/app/tailwind.config.ts")
      expect(config.tokens.vars).toBe("services/ui/app/tailwind.css")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("splits a UI root into the tiers its findings live in, and leaves the rules off", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          ["packages/domain/package.json", { name: "@acme/domain" }],
          ["packages/rest/package.json", { name: "@acme/rest" }],
        ],
        text: [
          ["pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n'],
          ["apps/web/components/ui/Button.tsx", "export const Button = () => null\n"],
          ["apps/web/routes/index.tsx", "export const Route = () => null\n"],
        ],
      },
      ["joggle"],
    )
    try {
      await initialiseIn(root)
      const starter = JSON.parse(readFileSync(join(root, "joggle.config.json"), "utf8"))
      const names = starter.architecture.layers.map((layer: { name: string }) => layer.name)
      // One `apps/web/**` layer cannot see components/ui -> components -> routes.
      expect(names).toEqual(
        expect.arrayContaining(["domain", "rest", "web-primitive", "web-local"]),
      )
      // The order and the forbid sets are judgement: nothing pretends to enforce them.
      expect(starter.rules["joggle/layer-direction"]).toBe("off")
      expect(starter.rules["joggle/layer-purity"]).toBe("off")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("names the repo from its manifest, not from the directory init ran in", async () => {
    const root = project(
      {
        json: [
          ["package.json", { name: "shakti-v2", description: "the repo, not the worktree" }],
          ["tsconfig.json", {}],
        ],
        text: [],
      },
      ["joggle"],
    )
    try {
      await initialiseIn(root)
      const cookbook = readFileSync(join(root, "JIG.md"), "utf8")
      // A worktree is named after the branch (`wt-jig-thorough`); the repo is named here.
      expect(cookbook).toContain("The conformance harness for shakti-v2.")
      expect(cookbook).not.toContain(root.split("/").at(-1) ?? "\u0000")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("never names a config a person owns: cutlist.config.json is reviewed, not generated", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          [".oxfmtrc.json", { printWidth: 110, ignorePatterns: [] }],
          ["cutlist.config.json", { primitive: [], shared: [], local: [] }],
          ["packages/domain/package.json", { name: "@acme/domain" }],
          ["packages/rest/package.json", { name: "@acme/rest" }],
        ],
        text: [["pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n']],
      },
      ["joggle"],
    )
    try {
      const result = await initialiseIn(root, { force: true })
      const note = result.profile.notes.find((entry) => entry.includes(".oxfmtrc.json"))
      expect(note).toContain("jig.config.json")
      // Drafted once, owned afterwards: exempting it from a formatter would exile the one
      // config in the harness a person is meant to edit.
      expect(note).not.toContain("cutlist.config.json")
      expect(JSON.parse(readFileSync(join(root, "cutlist.config.json"), "utf8"))).toEqual({
        primitive: [],
        shared: [],
        local: [],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("names the formatter that would rewrite a generated config, unless it already ignores it", async () => {
    const build = (ignorePatterns: ReadonlyArray<string>): string =>
      project(
        {
          json: [
            ["package.json", {}],
            ["tsconfig.json", {}],
            [".oxfmtrc.json", { printWidth: 110, ignorePatterns }],
            ["packages/domain/package.json", { name: "@acme/domain" }],
            ["packages/rest/package.json", { name: "@acme/rest" }],
          ],
          text: [["pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n']],
        },
        ["joggle"],
      )
    const unexempt = build([])
    const exempt = build(["jig.config.json", "joggle.config.json"])
    try {
      const warned = await initialiseIn(unexempt)
      const note = warned.profile.notes.find((entry) => entry.includes(".oxfmtrc.json"))
      // A generated file's bytes belong to the generator: name the exemption instead of
      // emitting JSON shaped for one formatter's print width.
      expect(note).toContain("jig.config.json, joggle.config.json are generated")
      expect(note).toContain("init --force")

      const quiet = await initialiseIn(exempt)
      expect(quiet.profile.notes.some((entry) => entry.includes(".oxfmtrc.json"))).toBe(false)
    } finally {
      rmSync(unexempt, { recursive: true, force: true })
      rmSync(exempt, { recursive: true, force: true })
    }
  })

  it("re-drafts the layers on --force and keeps the rules and forbids a person wrote", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          ["packages/domain/package.json", { name: "@acme/domain" }],
          ["packages/rest/package.json", { name: "@acme/rest" }],
        ],
        text: [["pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n']],
      },
      ["joggle"],
    )
    try {
      await initialiseIn(root)
      const file = join(root, "joggle.config.json")
      const first = JSON.parse(readFileSync(file, "utf8")) as {
        rules: Record<string, string>
        architecture: { layers: Array<{ name: string; include: string[]; forbid?: string[] }> }
      }
      // What a person commits after reviewing the draft: the rules are on, and one forbid has
      // been checked against the manifest it constrains.
      const edited = {
        ...first,
        rules: {
          ...first.rules,
          "joggle/import-cycle": "error",
          "joggle/layer-direction": "error",
        },
        architecture: {
          layers: first.architecture.layers.map((layer) =>
            layer.name === "domain" ? { ...layer, forbid: ["react*"] } : layer,
          ),
        },
      }
      writeFileSync(file, `${JSON.stringify(edited, null, 2)}\n`)

      // Without --force a reviewed vocabulary is kept whole: the file is a decision, not output.
      await initialiseIn(root)
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(edited)

      // With --force the includes follow the tree again, and the judgement follows the names.
      await initialiseIn(root, { force: true })
      const after = JSON.parse(readFileSync(file, "utf8")) as typeof first
      expect(after.architecture.layers.map((layer) => layer.name)).toEqual(["domain", "rest"])
      expect(after.architecture.layers[0]?.forbid).toEqual(["react*"])
      expect(after.rules["joggle/layer-direction"]).toBe("error")
      expect(after.rules["joggle/import-cycle"]).toBe("error")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes each split before the root that contains it, and names two app roots apart", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          ["packages/domain/package.json", { name: "@acme/domain" }],
          ["packages/rest/package.json", { name: "@acme/rest" }],
          // The real shape: the UI root is a directory INSIDE a workspace package.
          ["services/ui/package.json", { name: "@acme/ui" }],
          ["services/auth-ui/package.json", { name: "@acme/auth-ui" }],
        ],
        text: [
          ["pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "services/*"\n'],
          ["services/auth-ui/app/components/ui/Button.tsx", "export const Button = () => null\n"],
          ["services/auth-ui/app/routes/index.tsx", "export const Route = () => null\n"],
          ["services/ui/app/components/ui/Button.tsx", "export const Button = () => null\n"],
          ["services/ui/app/routes/index.tsx", "export const Route = () => null\n"],
          ["services/ui/app/utils/cn.ts", 'export const cn = () => ""\n'],
          ["services/ui/app/models/plan.ts", "export const plan = 1\n"],
          ["services/ui/app/types.ts", "export type Plan = 1\n"],
        ],
      },
      ["joggle"],
    )
    try {
      await initialiseIn(root)
      const starter = JSON.parse(readFileSync(join(root, "joggle.config.json"), "utf8"))
      const layers = starter.architecture.layers as ReadonlyArray<{
        readonly name: string
        readonly include: ReadonlyArray<string>
      }>
      const names = layers.map((layer) => layer.name)
      const at = (include: string): number =>
        layers.findIndex((layer) => layer.include.includes(include))

      // joggle's `layerOf` is `layers.find()`: a root written before its splits matches every
      // file under it, so the splits never apply and `layer-direction` reports 0 -- silence on
      // a tree with real findings.
      for (const [entry, pkg] of [
        ["services/auth-ui/app", "services/auth-ui"],
        ["services/ui/app", "services/ui"],
      ] as const) {
        expect(at(entry + "/components/ui/**")).toBeLessThan(at(entry + "/**"))
        expect(at(entry + "/routes/**")).toBeLessThan(at(entry + "/**"))
        // The root is still the catch-all for everything the tiers do not name...
        expect(at(entry + "/**")).toBeGreaterThanOrEqual(0)
        // ...and the package that contains it comes after, or it would claim every file first.
        expect(at(entry + "/**")).toBeLessThan(at(pkg + "/**"))
      }

      // A routes split without a support layer below it reads every route's import of
      // `utils/` or `models/` as upward -- 731 of 856 findings on the first adopter.
      const support = names.indexOf("ui-support")
      expect(support).toBeGreaterThanOrEqual(0)
      expect(support).toBeLessThan(names.indexOf("ui-primitive"))
      expect(support).toBeLessThan(names.indexOf("ui-local"))
      const supportLayer = layers[support]
      expect(supportLayer?.include).toEqual([
        "services/ui/app/utils/**",
        "services/ui/app/models/**",
        // A support name is a directory or its file: `types.ts` holds the shared types, and
        // leaving it in the root catch-all makes every route import read as upward.
        "services/ui/app/types.ts",
      ])

      // Both roots live in `app/`, which used to name two layers `app-shared` and two
      // `app-local`: a finding could not say which one it was in.
      expect(new Set(names).size).toBe(names.length)
      expect(names).toEqual(
        expect.arrayContaining(["auth-ui-primitive", "auth-ui-local", "ui-primitive", "ui-local"]),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("enables cutlist only when the repo has its config and the command", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          ["cutlist.config.json", { primitive: [], shared: [], local: [] }],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.engines.map((engine) => engine.id)).toEqual(["joggle", "cutlist"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("drafts a cutlist config from a UI layout, and says cutlist is not enabled yet", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
        text: [
          ["src/components/ui/.keep", ""],
          ["src/components/.keep", ""],
          ["src/routes/.keep", ""],
          ["tailwind.config.ts", "export default {}\n"],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.cutlistDraft?.roots).toEqual(["src"])
      expect(profile.cutlistDraft?.tiers).toEqual({
        primitive: ["components/ui"],
        shared: ["components"],
        local: ["routes"],
      })
      expect(profile.cutlistDraft?.tokens.from).toBe("tailwind.config.ts")
      expect(profile.notes.join("\n")).toContain("jig init --cutlist")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("reads each app's own tsconfig, so a flat UI root can resolve its imports", async () => {
    const paths = { compilerOptions: { paths: { "@/*": ["./*"] } } }
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          ["apps/web/tsconfig.json", paths],
          ["apps/admin/tsconfig.json", paths],
          ["libs/ui/tsconfig.json", { compilerOptions: { paths: { "~/*": ["./src/*"] } } }],
        ],
        text: [
          ["apps/web/components/ui/.keep", ""],
          ["apps/admin/components/.keep", ""],
          ["libs/ui/src/components/.keep", ""],
          ["tailwind.config.ts", "export default {}\n"],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const profile = await inspect(root)
      const alias = profile.cutlistDraft?.alias ?? {}
      expect([...(profile.cutlistDraft?.roots ?? [])].sort()).toEqual([
        "apps/admin",
        "apps/web",
        "libs/ui/src",
      ])
      // `apps/web` and `apps/admin` are roots that *are* the app directory, so their
      // tsconfig is inside them rather than in the parent. Both targets must survive.
      expect([...(alias["@/*"] ?? [])].sort()).toEqual(["apps/admin/*", "apps/web/*"])
      // `libs/ui/src` keeps its tsconfig one level up, which must still be read.
      expect(alias["~/*"]).toEqual(["libs/ui/src/*"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("notes content mappers it will not index", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          [
            "tsconfig.json",
            {
              contentMappers: [{ package: "vue-content-mapper", extensions: [".vue"] }],
            },
          ],
        ],
      },
      ["joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.notes.join("\n")).toContain("content mappers")
      expect(profile.notes.join("\n")).toContain("runExternalCode")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("honours an explicit gate mode", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
      },
      ["joggle"],
    )
    try {
      const profile = await run(
        inspectRepo(root, { gateMode: "all" }).pipe(Effect.provide(NodeServices.layer)),
      )
      expect(profile.gateMode).toBe("all")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("does not claim a gate a kept config does not have", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
          [
            "jig.config.json",
            {
              engines: [
                {
                  id: "plumb",
                  kind: "oxlint-plugin",
                  command: "oxlint",
                  config: ".oxlintrc.json",
                },
              ],
              gate: { mode: "touched-files", baseline: ".jig-baseline.json" },
            },
          ],
        ],
      },
      ["oxlint"],
    )
    try {
      const kept = await run(
        inspectRepo(root, { gateMode: "all" }).pipe(Effect.provide(NodeServices.layer)),
      )
      expect(kept.gateMode).toBe("touched-files")
      expect(kept.notes.join("\n")).toContain("pass --force")

      const forced = await run(
        inspectRepo(root, { gateMode: "all", force: true }).pipe(
          Effect.provide(NodeServices.layer),
        ),
      )
      expect(forced.gateMode).toBe("all")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("keeps the engines a config declares, and adds the ones this run detects", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
          [
            "jig.config.json",
            {
              engines: [
                {
                  id: "plumb-goals",
                  kind: "oxlint-plugin",
                  command: "oxlint",
                  config: "goals/oxlint.config.ts",
                  args: ["goals/src"],
                },
              ],
              gate: { mode: "all", baseline: ".jig-baseline.json" },
            },
          ],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.engines.map((engine) => engine.id)).toEqual(["plumb-goals", "plumb", "joggle"])
      // A repo's own entry wins: detection cannot reproduce the scope it chose.
      expect(profile.engines[0]?.args).toEqual(["goals/src"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("drops a configured engine whose command no longer resolves, and says so", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          [
            "jig.config.json",
            {
              engines: [{ id: "gone", kind: "process", command: "not-a-real-engine" }],
              gate: { mode: "all", baseline: ".jig-baseline.json" },
            },
          ],
        ],
      },
      ["joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(profile.engines.map((engine) => engine.id)).toEqual(["joggle"])
      expect(profile.notes.join("\n")).toContain("does not resolve")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("reads cutlist where its engine scans, and describes the artifact from the root", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          [
            "jig.config.json",
            {
              engines: [
                {
                  id: "cutlist",
                  kind: "process",
                  command: "cutlist",
                  args: ["--cwd", "examples/self"],
                },
              ],
              gate: { mode: "all", baseline: ".jig-baseline.json" },
            },
          ],
        ],
        text: [
          [
            "examples/self/cutlist.config.json",
            JSON.stringify({
              roots: ["src"],
              tiers: { primitive: [], shared: [], local: [] },
              tokens: { from: "src/styles/app.css" },
              ownership: { routeOwner: "first-segment", transitive: false },
              output: { catalog: "tools/vocab/catalog.json" },
            }),
          ],
        ],
      },
      ["cutlist"],
    )
    try {
      const result = await initialiseIn(root)
      expect(result.profile.cutlistExisting?.path).toBe("examples/self/cutlist.config.json")
      // The configured cutlist survives, and the detected joggle is added beside it.
      expect(result.profile.engines.map((engine) => engine.id)).toEqual(["cutlist", "joggle"])
      expect(summaryFor(result)).toContain("configured (examples/self/cutlist.config.json)")
      const text = readFileSync(join(root, ".gitattributes"), "utf8")
      expect(text).toContain("examples/self/tools/vocab/catalog.json linguist-generated=true")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("says so when another ledger already answers these findings", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          [".oxlint-errors-baseline.json", { identities: ["no-x:a.ts"] }],
        ],
      },
      [],
    )
    try {
      const profile = await inspect(root)
      expect(profile.notes.join("\n")).toContain(".oxlint-errors-baseline.json")
      expect(profile.notes.join("\n")).toContain("which one owns these findings")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("prints the invocation a person can type, not the binary a global install owns", async () => {
    const root = project(
      {
        json: [["package.json", { packageManager: "pnpm@10.0.0" }]],
        text: [["src/components/Button.tsx", "export const Button = () => null\n"]],
      },
      ["cutlist"],
    )
    try {
      const result = await initialiseIn(root, { cutlist: true })
      // The project has its own node_modules/.bin/cutlist, so the paste names the
      // package-manager invocation instead of a command only some PATHs have.
      expect(onboardingFor(result.profile)).toContain("pnpm exec cutlist build")
      expect(summaryFor(result)).toContain("pnpm exec cutlist build")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("documents the room when this repo runs one, and asks before registering it", async () => {
    const root = project(
      {
        json: [["package.json", {}]],
        text: [["packages/room/package.json", "{}"]],
      },
      [],
    )
    try {
      const profile = await inspect(root)
      expect(profile.facts.has("room")).toBe(true)
      expect(profile.notes.join("\n")).toContain("room not initialised")
      expect(cookbookFor(profile)).toContain("room doctor")
      expect(cookbookFor(profile)).toContain("room board")
      expect(onboardingFor(profile)).toContain("room doctor")
      expect(onboardingFor(profile)).toContain("room plan")
      expect(onboardingFor(profile)).toContain("**STOP and ask**")
      // The prompt names what the room needs on the machine, and says who checks it.
      expect(onboardingFor(profile)).toContain("celld")
      expect(onboardingFor(profile)).toContain("gh extension install cli/gh-webhook")
      expect(onboardingFor(profile)).toContain("room doctor")
      expect(cookbookFor(profile)).toContain("room daemon")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("a repository that ignores the harness", () => {
  it("says when a ledger can be committed while its rulebook cannot", async () => {
    const root = project({ json: [["package.json", {}]] }, [])
    try {
      execFileSync("git", ["init", "-q"], { cwd: root })
      writeFileSync(join(root, ".gitignore"), "jig.config.json\n")
      const result = await initialiseIn(root)
      const notes = result.profile.notes.join("\n")
      // The record travels and the rules that produced it do not: a ratchet nobody can read.
      expect(notes).toContain("can be committed while")
      expect(notes).toContain("jig.config.json")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("reports the written paths git refuses to track", async () => {
    const root = project({ json: [["package.json", {}]] }, [])
    try {
      execFileSync("git", ["init", "-q"], { cwd: root })
      writeFileSync(
        join(root, ".gitignore"),
        [
          "jig.config.json",
          "jig.config.json".replace("jig.config", "joggle.config"),
          "JIG.md",
          "ONBOARD.md",
          ".jig-baseline.json",
        ].join("\n") + "\n",
      )
      const result = await initialiseIn(root)
      expect(result.ignore.map((entry) => entry.path)).toEqual(
        expect.arrayContaining(["jig.config.json", "JIG.md", "ONBOARD.md", ".jig-baseline.json"]),
      )
      expect(summaryFor(result)).toContain("local-only")
      // The paste asks the person to settle it, because jig cannot edit their .gitignore.
      expect(onboardingFor(result.profile)).toContain("gitignored")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("making the harness real", () => {
  it("removes the exact ignore lines, and names what a pattern still hides", async () => {
    const root = project({ json: [["package.json", {}]] }, [])
    try {
      execFileSync("git", ["init", "-q"], { cwd: root })
      writeFileSync(
        join(root, ".gitignore"),
        ["JIG.md", "*.config.json", "tools/ui-catalog/"].join("\n") + "\n",
      )
      const result = await initialiseIn(root, { unignore: true })
      // The line is gone; the glob is reported and left alone.
      expect(
        result.ignore.filter((entry) => entry.status === "removed").map((entry) => entry.path),
      ).toEqual(["JIG.md"])
      const text = readFileSync(join(root, ".gitignore"), "utf8")
      expect(text).not.toContain("JIG.md")
      expect(text).toContain("*.config.json")
      expect(result.profile.notes.join("\n")).toContain("hidden by a pattern")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes a scoped hook that steps aside, then keeps its own work", async () => {
    const root = project({ json: [["package.json", {}]] }, [])
    try {
      execFileSync("git", ["init", "-q"], { cwd: root })
      const first = await initialiseIn(root, { hooks: true })
      expect(first.hooks).toBe("written")
      const hook = readFileSync(join(root, ".git", "hooks", "pre-commit"), "utf8")
      expect(hook).toContain("jig: generated pre-commit")
      expect(hook).toContain("check --gate touched-files")
      // A machine without the CLI must not fail a commit.
      expect(hook).toContain("pre-commit check skipped")

      const second = await initialiseIn(root, { hooks: true })
      expect(second.hooks).toBe("kept")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("never replaces a hook that is not jig's", async () => {
    const root = project({ json: [["package.json", {}]] }, [])
    try {
      execFileSync("git", ["init", "-q"], { cwd: root })
      const hook = join(root, ".git", "hooks", "pre-commit")
      mkdirSync(dirname(hook), { recursive: true })
      writeFileSync(hook, "#!/bin/sh\necho someone-else\n")
      const result = await initialiseIn(root, { hooks: true })
      expect(result.hooks).toBe("foreign")
      expect(result.profile.notes.join("\n")).toContain("left alone")
      expect(readFileSync(hook, "utf8")).toContain("someone-else")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("initialise", () => {
  it("writes a config, an empty baseline, the docs, and a counted joggle config", async () => {
    const root = project(
      {
        json: [
          ["package.json", { packageManager: "pnpm@9.10.0", scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
        ],
        text: [
          [
            "AGENTS.md",
            "**Project**: a forestry system.\n**Stack**: TypeScript, Fastify, Postgres\n",
          ],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      const result = await initialiseIn(root)
      expect(result.written).toEqual(
        expect.arrayContaining([
          "jig.config.json",
          ".jig-baseline.json",
          "JIG.md",
          "ONBOARD.md",
          "joggle.config.json",
        ]),
      )
      const config = JSON.parse(readFileSync(join(root, "jig.config.json"), "utf8"))
      expect(config.gate.mode).toBe("touched-files")
      expect(config.engines.map((engine: { id: string }) => engine.id)).toEqual(["plumb", "joggle"])
      const joggle = JSON.parse(readFileSync(join(root, "joggle.config.json"), "utf8"))
      expect(joggle.unavailable).toBe("count")
      expect(joggle.evidence.repository).toContain("forestry system")
      const onboarding = readFileSync(join(root, "ONBOARD.md"), "utf8")
      expect(onboarding).toContain("jig engines")
      expect(onboarding).toContain("STOP and ask")
      // The prompt is the door: it names the global install and the ratchet's one sin.
      expect(onboarding).toContain("Never, without asking me")
      expect(onboarding).toContain("`jig baseline`")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("keeps the chosen gate in the config and in the next command", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
        ],
      },
      ["oxlint"],
    )
    try {
      const plan = await initialiseIn(root, { gateMode: "all", dryRun: true })
      expect(summaryFor(plan)).toContain("jig init --gate all")
      expect(onboardingFor(plan.profile)).toContain("jig init --gate all")

      const applied = await initialiseIn(root, { gateMode: "all" })
      const config = JSON.parse(readFileSync(join(root, "jig.config.json"), "utf8"))
      expect(config.gate.mode).toBe("all")
      expect(applied.profile.gateMode).toBe("all")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes the paths an existing config already names", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
          [
            "jig.config.json",
            {
              engines: [{ id: "joggle", kind: "process", command: "joggle" }],
              gate: { mode: "all", baseline: "accepted/ledger.json", failOn: "any-new" },
              agent: { cookbook: "AGENT_JIG.md", onboarding: "AGENT_ONBOARD.md" },
            },
          ],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      const result = await initialiseIn(root)
      expect(result.kept).toContain("jig.config.json")
      expect(result.written).toContain("accepted/ledger.json")
      expect(result.written).toContain("AGENT_JIG.md")
      expect(result.written).toContain("AGENT_ONBOARD.md")
      expect(readFileSync(join(root, "AGENT_JIG.md"), "utf8")).toContain("accepted/ledger.json")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes the cutlist draft only when asked, and does not enable it before review", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
        text: [
          ["src/components/ui/.keep", ""],
          ["src/routes/.keep", ""],
          ["tailwind.config.ts", "export default {}\n"],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const result = await initialiseIn(root, { cutlist: true })
      expect(result.cutlistConfig).toBe("written")
      expect(result.written).toContain("cutlist.config.json")
      const config = JSON.parse(readFileSync(join(root, "cutlist.config.json"), "utf8"))
      expect(config.roots).toEqual(["src"])
      const jig = JSON.parse(readFileSync(join(root, "jig.config.json"), "utf8"))
      expect(jig.engines.map((engine: { id: string }) => engine.id)).not.toContain("cutlist")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("merges the generated-artifact block and leaves the repo's own gitattributes alone", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
        text: [
          ["src/components/ui/.keep", ""],
          ["tailwind.config.ts", "export default {}\n"],
          [".gitattributes", "*.png binary\n"],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const result = await initialiseIn(root, { cutlist: true })
      expect(result.gitattributes).toBe("appended")
      const text = readFileSync(join(root, ".gitattributes"), "utf8")
      expect(text).toContain("*.png binary")
      expect(text).toContain("tools/ui-catalog/catalog.json linguist-generated=true")
      expect(text).not.toContain("tools/ui-catalog/intent")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes one block however many times init runs", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
        text: [
          ["src/components/ui/.keep", ""],
          ["tailwind.config.ts", "export default {}\n"],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      await initialiseIn(root, { cutlist: true })
      const second = await initialiseIn(root, { cutlist: true })
      expect(second.gitattributes).toBe("unchanged")
      const text = readFileSync(join(root, ".gitattributes"), "utf8")
      expect(text.split("# jig: generated artifacts")).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("describes the paths a repo configured, not cutlist's defaults", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
          [
            "cutlist.config.json",
            {
              roots: ["src"],
              tiers: { primitive: [], shared: [], local: [] },
              tokens: { from: "tailwind.css" },
              ownership: { routeOwner: "first-segment", transitive: false },
              output: { catalog: "docs/vocabulary/catalog.json" },
            },
          ],
        ],
        text: [
          ["src/routes/.keep", ""],
          ["tailwind.css", ""],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const result = await initialiseIn(root)
      expect(result.gitattributes).toBe("created")
      const text = readFileSync(join(root, ".gitattributes"), "utf8")
      expect(text).toContain("docs/vocabulary/catalog.json linguist-generated=true")
      expect(text).not.toContain("tools/ui-catalog/catalog.json")
      // A path the config did not move keeps its default.
      expect(text).toContain("tools/ui-catalog/menu.json linguist-generated=true")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("prints a plan without writing when dryRun is set", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          ["tsconfig.json", {}],
        ],
        text: [
          ["src/components/ui/.keep", ""],
          ["tailwind.config.ts", "export default {}\n"],
        ],
      },
      ["joggle", "cutlist"],
    )
    try {
      const result = await initialiseIn(root, { cutlist: true, dryRun: true })
      expect(result.dryRun).toBe(true)
      expect(result.written).toContain("jig.config.json")
      expect(result.written).toContain("cutlist.config.json")
      expect(readdirSync(root).sort((left, right) => left.localeCompare(right))).not.toContain(
        "jig.config.json",
      )
      expect(readdirSync(root).sort((left, right) => left.localeCompare(right))).not.toContain(
        "cutlist.config.json",
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("is idempotent, and --force never replaces the accepted baseline", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      await initialiseIn(root)
      const baseline = '{"identities":["accepted"]}\n'
      writeFileSync(join(root, ".jig-baseline.json"), baseline)

      const again = await initialiseIn(root)
      expect(again.kept).toEqual(
        expect.arrayContaining(["jig.config.json", ".jig-baseline.json", "JIG.md", "ONBOARD.md"]),
      )
      expect(readFileSync(join(root, ".jig-baseline.json"), "utf8")).toBe(baseline)

      const forced = await initialiseIn(root, { force: true })
      expect(forced.written).toEqual(
        expect.arrayContaining(["jig.config.json", "JIG.md", "ONBOARD.md"]),
      )
      expect(forced.kept).toContain(".jig-baseline.json")
      expect(readFileSync(join(root, ".jig-baseline.json"), "utf8")).toBe(baseline)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes every engine a configured harness declares when forced", async () => {
    const root = project(
      {
        json: [
          ["package.json", { scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
          [
            "jig.config.json",
            {
              engines: [
                {
                  id: "plumb-goals",
                  kind: "oxlint-plugin",
                  command: "oxlint",
                  config: "goals/oxlint.config.ts",
                },
                { id: "joggle", kind: "process", command: "joggle", config: "joggle.config.json" },
              ],
              gate: { mode: "all", baseline: ".jig-baseline.json" },
            },
          ],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      await initialiseIn(root, { force: true })
      const config = JSON.parse(readFileSync(join(root, "jig.config.json"), "utf8"))
      expect(config.engines.map((engine: { id: string }) => engine.id)).toEqual([
        "plumb-goals",
        "joggle",
        "plumb",
      ])
      // The repo's own config for an engine it configured is not replaced by the generic one.
      expect(config.engines[1].config).toBe("joggle.config.json")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const profileFor = (gateMode: "all" | "touched-files") => ({
  root: "/repo",
  name: "repo",
  packageManager: "pnpm" as const,
  run: "pnpm",
  jig: "jig",
  facts: new Set<"ci" | "live-judgement" | "typescript" | "workspaces">(["typescript"]),
  agentDocs: [],
  summary: "",
  commands: [],
  lint: { tool: "none" as const, config: undefined, script: undefined },
  engines: [],
  notes: [],
  gateMode,
  baseline: ".jig-baseline.json",
  cookbook: "JIG.md",
  onboarding: "ONBOARD.md",
  jigSource: "@autotelic/jig-cli",
  hosts: new Set<"opencode" | "pi">(),
  cutlistDraft: undefined,
})

describe("rendering", () => {
  it("always writes the gate it was given", () => {
    fc.assert(
      fc.property(fc.boolean(), (all) => {
        const gateMode = all ? "all" : "touched-files"
        expect(configFor(profileFor(gateMode)).gate.mode).toBe(gateMode)
      }),
    )
  })

  it("serializes the plan for a host that reads it", async () => {
    const root = project({ json: [["package.json", {}]] }, [])
    try {
      const result = await initialiseIn(root, { dryRun: true })
      const plan = JSON.parse(initJson(result, "prompt"))
      expect(plan.plan.dryRun).toBe(true)
      expect(plan.plan.written).toContain("jig.config.json")
      expect(plan.profile.facts).toEqual([])
      expect(plan.prompt).toBe("prompt")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("tells an agent to run init when the repo is not configured yet", () => {
    expect(onboardingFor(profileFor("touched-files"))).toContain("not initialised yet")
  })

  it("starts by putting the CLI on the machine, in the package manager's own dialect", () => {
    expect(onboardingFor(profileFor("all"))).toContain("pnpm add -g @autotelic/jig-cli")
    expect(onboardingFor(profileFor("all"))).toContain("pnpm setup")
    expect(onboardingFor({ ...profileFor("all"), packageManager: "npm", run: "npm" })).toContain(
      "npm install -g @autotelic/jig-cli",
    )
    expect(onboardingFor({ ...profileFor("all"), packageManager: "yarn", run: "yarn" })).toContain(
      "yarn global add @autotelic/jig-cli",
    )
  })

  it("names the checkout this tree builds, and keeps the hosts already wired", async () => {
    const root = project(
      {
        json: [
          ["package.json", {}],
          [".pi/settings.json", { packages: ["../packages/jig-cli"] }],
          ["opencode.json", {}],
        ],
        text: [["packages/jig-cli/package.json", "{}"]],
      },
      [],
    )
    try {
      const profile = await inspect(root)
      expect(profile.jigSource).toBe("./packages/jig-cli")
      expect([...profile.hosts].sort((a, b) => a.localeCompare(b))).toEqual(["opencode", "pi"])
      const prompt = onboardingFor(profile)
      expect(prompt).toContain("-g ./packages/jig-cli")
      // This repository *is* the source: a person pointed here by URL needs the adopter file.
      expect(prompt).toContain("ADOPT.md")
      expect(onboardingFor(profileFor("all"))).not.toContain("ADOPT.md")
      expect(prompt).toContain("pi update --extensions")
      // A wired host is updated, not added twice.
      expect(prompt).toContain("keep the existing")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("names the engines, the gate, and the first command in the docs", async () => {
    const root = project(
      {
        json: [
          ["package.json", { packageManager: "pnpm@9.10.0", scripts: { lint: "oxlint ." } }],
          ["tsconfig.json", {}],
          [".oxlintrc.json", OXLINT],
        ],
      },
      ["oxlint", "joggle"],
    )
    try {
      const profile = await inspect(root)
      expect(cookbookFor(profile)).toContain("plumb")
      expect(cookbookFor(profile)).toContain("touched-files")
      expect(onboardingFor(profile)).toContain("jig check --limit 20")
      expect(configFor(profile).engines).toHaveLength(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("init --skills", () => {
  it("copies the bundled skills into .agents/skills, where both hosts look", async () => {
    const root = project({}, ["pnpm"])
    try {
      const result = await initialiseIn(root, { skills: true })
      const names = result.skills.map((skill) => skill.name)
      expect(names).toContain("room")
      expect(names).toContain("intercom-setup")
      expect(names).toContain("feedback-loop")
      expect(result.skills.every((skill) => skill.state === "written")).toBe(true)
      const body = readFileSync(join(root, ".agents", "skills", "room", "SKILL.md"), "utf8")
      // Frontmatter is the contract both hosts read: a name and a routing description.
      expect(body.startsWith("---\nname: room\ndescription:")).toBe(true)
      expect(result.written).toContain(".agents/skills/room/SKILL.md")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("reports kept when the file already matches, and writes nothing", async () => {
    const root = project({}, ["pnpm"])
    try {
      await initialiseIn(root, { skills: true })
      const before = readFileSync(join(root, ".agents", "skills", "room", "SKILL.md"), "utf8")
      const again = await initialiseIn(root, { skills: true })
      expect(again.skills.every((skill) => skill.state === "kept")).toBe(true)
      expect(readFileSync(join(root, ".agents", "skills", "room", "SKILL.md"), "utf8")).toBe(before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("writes nothing in --print mode, and says what it would write", async () => {
    const root = project({}, ["pnpm"])
    try {
      const planned = await initialiseIn(root, { skills: true, dryRun: true })
      expect(planned.skills.every((skill) => skill.state === "would write")).toBe(true)
      expect(existsSync(join(root, ".agents"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

it("installs the skills by default: they are harness files, not a second step", async () => {
  const root = project({}, ["pnpm"])
  try {
    const result = await initialiseIn(root)
    expect(result.skills.length).toBeGreaterThan(0)
    expect(result.skills.map((skill) => skill.name)).toContain("project-run")
    expect(existsSync(join(root, ".agents", "skills", "project-run", "SKILL.md"))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("keeps a skill someone edited, and --force replaces it", async () => {
  const root = project({}, ["pnpm"])
  try {
    await initialiseIn(root)
    const target = join(root, ".agents", "skills", "room", "SKILL.md")
    const mine = "---\nname: room\ndescription: mine.\n---\n\nour own room notes\n"
    writeFileSync(target, mine)
    const kept = await initialiseIn(root)
    expect(kept.skills.find((skill) => skill.name === "room")?.state).toBe("kept")
    expect(readFileSync(target, "utf8")).toBe(mine)
    expect(kept.profile.notes.some((note) => note.includes("differs from the shipped skill"))).toBe(
      true,
    )
    await initialiseIn(root, { force: true })
    expect(readFileSync(target, "utf8")).not.toBe(mine)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
