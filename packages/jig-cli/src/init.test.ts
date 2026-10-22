import fc from "fast-check"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { configFor, cookbookFor, initialise, inspectRepo, onboardingFor } from "./init.ts"

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

const initialiseIn = (
  root: string,
  options: { readonly force?: boolean; readonly cutlist?: boolean; readonly dryRun?: boolean } = {},
) => run(initialise(root, options).pipe(Effect.provide(NodeServices.layer)))

const OXLINT = {
  jsPlugins: [{ name: "plumb", specifier: "@autotelic/plumb" }],
  rules: { "plumb/no-known-value-widening": "error" },
}

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
      expect(onboarding).toContain("Do not run `jig baseline` without asking")
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

  it("tells an agent to run init when the repo is not configured yet", () => {
    expect(onboardingFor(profileFor("touched-files"))).toContain("not initialised yet")
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
