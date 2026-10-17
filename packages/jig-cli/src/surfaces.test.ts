/* oxlint-disable plumb/no-chained-type-assertions -- a fake for the OpenCode host cannot structurally overlap the real one, which carries twenty-odd domains this plugin never reads; the assertion is the test's subject, not an accident. */
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { afterAll, describe, expect, it } from "vitest"
import plugin from "./opencode.ts"

/*
 * Byte-equality between the CLI and the two agent surfaces.
 *
 * Both surfaces are transports: they build an argv and hand back the child's stdout. The
 * claim — "the agent gets exactly what a human's terminal shows" — is only true if the bytes
 * are identical, so this suite runs the real CLI in a temp repo and then drives each surface
 * through a fake host, comparing the strings. A second renderer, or a dropped byte, fails
 * here rather than in a user's session.
 *
 * The pi extension is deliberately outside the compiler's program (pi strips types itself and
 * `tsconfig.json` includes `src` only), so it is loaded here by computed specifier: the test
 * exercises it at runtime without pulling it into typecheck. That, plus the faked hosts, is
 * why this file crosses the same boundary `opencode.ts` does.
 */

const here = dirname(fileURLToPath(import.meta.url))
const cliSource = resolve(here, "cli.ts")
const oxlint = resolve(here, "../../../node_modules/.bin/oxlint")
const MEGABYTE = 32 * 1024 * 1024

interface Repo {
  readonly root: string
  readonly wrapper: string
}

/** The temp repo, built once at module load so no module-scope binding is ever mutated. */
const prepareRepo = (): Repo => {
  const root = mkdtempSync(join(tmpdir(), "jig-surfaces-"))
  // A wrapper so both surfaces and the reference go through the same launch, independent of
  // whether `dist/` happens to be built. `JIG_BIN` is the surfaces' own override.
  const wrapper = join(root, "jig")
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --conditions=development ${JSON.stringify(cliSource)} "$@"\n`,
  )
  chmodSync(wrapper, 0o755)
  writeFileSync(
    join(root, "jig.config.json"),
    `${JSON.stringify(
      {
        engines: [{ id: "plumb", kind: "oxlint-plugin", command: oxlint }],
        gate: { mode: "all", baseline: ".jig-baseline.json" },
        report: { format: "text" },
      },
      null,
      2,
    )}\n`,
  )
  writeFileSync(join(root, "a.ts"), "const unused = 1\nexport const ok = 2\n")
  process.env.JIG_BIN = wrapper
  return { root, wrapper }
}

const repo = prepareRepo()

/** The CLI's report bytes, through the same entry the surfaces use. Non-zero exits included. */
const cliBytes = (args: ReadonlyArray<string>): string => {
  const result = spawnSync(repo.wrapper, [...args], {
    cwd: repo.root,
    encoding: "utf8",
    maxBuffer: MEGABYTE,
  })
  return (result.stdout ?? "").trim()
}

const checkArgs = (cwd: string, format: string): ReadonlyArray<string> => [
  "check",
  "--cwd",
  cwd,
  "--format",
  format,
]

/**
 * Erase the one thing that legitimately differs between two runs of the same repo: the wall
 * clock each engine reported. Everything else in every projection is a function of the report.
 */
const withoutTiming = (text: string): string =>
  text
    .replace(/"durationMs": \d+/g, '"durationMs": 0')
    .replace(/"elapsedMs": \d+/g, '"elapsedMs": 0')

interface PiTool {
  readonly name: string
  readonly execute: (
    callId: string,
    params: { readonly cwd?: string },
    signal: undefined,
    onUpdate: undefined,
    ctx: { readonly cwd: string },
  ) => Promise<{ readonly content: ReadonlyArray<{ readonly text: string }> }>
}

const loadPi = async (): Promise<(pi: unknown) => void> => {
  const url = new URL("../extensions/jig.ts", import.meta.url).href
  // SAFETY: the extension's own export shape (`default(pi)`) is what the dynamic import
  // yields; the module is deliberately outside the compiler's program, so its type is not
  // available here and the runtime contract is asserted instead.
  const mod = (await import(/* @vite-ignore */ url)) as { readonly default: (pi: unknown) => void }
  return mod.default
}

/** Drive the pi extension's `jig_check` tool through a host that only records and executes. */
const piCheckBytes = async (cwd: string): Promise<string> => {
  const tools = new Map<string, PiTool>()
  const pi = {
    exec: async (
      command: string,
      args: ReadonlyArray<string>,
      options: { readonly cwd: string },
    ): Promise<{ stdout: string; stderr: string; code: number }> => {
      const result = spawnSync(command, [...args], {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: MEGABYTE,
      })
      return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status ?? 1 }
    },
    registerTool: (tool: PiTool): void => {
      tools.set(tool.name, tool)
    },
    registerCommand: (): void => {},
  }
  const extension = await loadPi()
  extension(pi)
  const tool = tools.get("jig_check")
  if (tool === undefined) throw new Error("jig_check was not registered")
  const result = await tool.execute("call", { cwd }, undefined, undefined, { cwd })
  return result.content[0]?.text ?? ""
}

interface OcTool {
  readonly name: string
  readonly execute: (input: unknown, context: unknown) => Promise<{ readonly content: string }>
}

/** Drive the OpenCode plugin's `jig.check` tool through a host that only records. */
const ocCheckBytes = async (cwd: string, format: string): Promise<string> => {
  const tools = new Map<string, OcTool>()
  const editor = {
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    add: (tool: OcTool): void => {
      tools.set(tool.name, tool)
    },
    update: () => {},
    remove: () => {},
  }
  const context = {
    location: { directory: cwd },
    tool: {
      transform: async (callback: (editor: unknown) => void): Promise<{ dispose: () => void }> => {
        callback(editor)
        return { dispose: () => {} }
      },
    },
    command: { transform: async (): Promise<{ dispose: () => void }> => ({ dispose: () => {} }) },
  }
  // SAFETY: the host API is far wider than the three domains this plugin touches
  // (`location`, `tool`, `command`); the rest is never read, so the fake is asserted to it.
  await plugin.setup(context as unknown as Parameters<typeof plugin.setup>[0])
  const tool = tools.get("check")
  if (tool === undefined) throw new Error("jig.check was not registered")
  const result = await tool.execute({ cwd, format }, { signal: undefined })
  return result.content
}

afterAll(() => {
  delete process.env.JIG_BIN
  rmSync(repo.root, { recursive: true, force: true })
})

describe("the agent surfaces and the CLI", () => {
  it("hands pi exactly the CLI's report bytes", async () => {
    const expected = cliBytes(checkArgs(repo.root, "text"))
    expect(expected).toContain("eslint/no-unused-vars")
    expect(await piCheckBytes(repo.root)).toBe(expected)
  })

  it("hands OpenCode exactly the CLI's report bytes", async () => {
    const expected = cliBytes(checkArgs(repo.root, "text"))
    expect(await ocCheckBytes(repo.root, "text")).toBe(expected)
  })

  it("is byte-identical for every format OpenCode offers (property)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("text", "github", "json"), async (format) => {
        const surface = await ocCheckBytes(repo.root, format)
        expect(withoutTiming(surface)).toBe(withoutTiming(cliBytes(checkArgs(repo.root, format))))
      }),
      { numRuns: 3 },
    )
  }, 60_000)
})
