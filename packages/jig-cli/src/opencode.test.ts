import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { resolveLauncher, type LaunchEnvironment } from "./opencode.ts"

/*
 * The OpenCode launcher's fallback, tested off the host.
 *
 * The bug this guards is invisible to the byte-parity suite: that suite pins `JIG_BIN`, so
 * it never exercises the fallback. In the real OpenCode server `process.execPath` is the
 * bun-compiled OpenCode binary, so a fallback that launched `process.execPath <jig.js>` ran
 * OpenCode and printed its help instead of a report. `resolveLauncher` takes the host's
 * facts as data, so the decision is checked here without spawning anything.
 */

const env = (over: Partial<LaunchEnvironment> = {}): LaunchEnvironment => ({
  override: undefined,
  onPath: () => undefined,
  execPath: "/opt/opencode/opencode.exe",
  exists: () => false,
  root: "/pkg",
  ...over,
})

const only =
  (name: string) =>
  (candidate: string): string | undefined =>
    candidate === name ? `/usr/bin/${name}` : undefined

describe("the OpenCode launcher fallback", () => {
  it("lets JIG_BIN win over everything", () => {
    expect(resolveLauncher(env({ override: "/custom/jig", onPath: () => "/usr/bin/jig" }))).toEqual(
      {
        command: "/custom/jig",
        args: [],
      },
    )
  })

  it("prefers a jig on PATH", () => {
    expect(resolveLauncher(env({ onPath: only("jig") }))).toEqual({ command: "jig", args: [] })
  })

  it("runs the build under Node, not the host binary", () => {
    const launcher = resolveLauncher(
      env({ onPath: only("node"), exists: (p) => p === "/pkg/dist/cli.js" }),
    )
    expect(launcher).toEqual({ command: "/usr/bin/node", args: ["/pkg/dist/cli.js"] })
  })

  it("falls back to source through the development condition", () => {
    const launcher = resolveLauncher(
      env({ onPath: only("node"), exists: (p) => p === "/pkg/src/cli.ts" }),
    )
    expect(launcher).toEqual({
      command: "/usr/bin/node",
      args: ["--conditions=development", "/pkg/src/cli.ts"],
    })
  })

  it("names the host executable only when no Node is on PATH", () => {
    const launcher = resolveLauncher(env({ exists: (p) => p === "/pkg/dist/cli.js" }))
    expect(launcher).toEqual({ command: "/opt/opencode/opencode.exe", args: ["/pkg/dist/cli.js"] })
  })

  it("never uses the host binary as the interpreter when Node is available (property)", () => {
    fc.assert(
      fc.property(fc.constantFrom("dist/cli.js", "src/cli.ts", "bin/jig.js"), (which) => {
        const launcher = resolveLauncher(
          env({ onPath: only("node"), exists: (p) => p === `/pkg/${which}` }),
        )
        expect(launcher.command).toBe("/usr/bin/node")
      }),
    )
  })
})
