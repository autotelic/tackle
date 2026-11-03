import fc from "fast-check"
import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { resolveLauncher, type LaunchEnvironment } from "./opencode.ts"

/*
 * The OpenCode launcher, without spawning.
 *
 * The same bug class as jig's plugin: the OpenCode server is a bun-compiled binary, so
 * `process.execPath` there is OpenCode, not Node. These cases pin the order -- override, PATH,
 * this build, this source -- and that the fallback names an interpreter found on PATH.
 */

const env = (overrides: Partial<LaunchEnvironment>): LaunchEnvironment => ({
  override: undefined,
  onPath: () => Option.none(),
  execPath: "/usr/local/bin/opencode",
  exists: () => false,
  root: "/pkg",
  ...overrides,
})

describe("the OpenCode launcher", () => {
  it("prefers an explicit override, then a room on PATH", () => {
    expect(resolveLauncher(env({ override: "/opt/room" }))).toEqual({
      command: "/opt/room",
      args: [],
    })
    expect(resolveLauncher(env({ onPath: () => Option.some("/bin/room") }))).toEqual({
      command: "room",
      args: [],
    })
  })

  it("runs this build through a node on PATH, never through the OpenCode binary", () => {
    const launcher = resolveLauncher(
      env({
        onPath: (name) => (name === "node" ? Option.some("/bin/node") : Option.none()),
        exists: (path) => path === "/pkg/dist/cli.js",
      }),
    )
    expect(launcher).toEqual({ command: "/bin/node", args: ["/pkg/dist/cli.js"] })
  })

  it("property: with room off PATH, the launcher names the node it found, never execPath", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z]{2,8}$/u), fc.boolean(), (node, hasDist) => {
        const launcher = resolveLauncher(
          env({
            execPath: "/usr/local/bin/opencode",
            onPath: (name) => (name === "node" ? Option.some(node) : Option.none()),
            exists: (path) => (path === "/pkg/dist/cli.js" ? hasDist : path === "/pkg/src/cli.ts"),
          }),
        )
        return launcher.command === node
      }),
    )
  })

  it("falls back to the source under the development condition", () => {
    const launcher = resolveLauncher(
      env({
        onPath: (name) => (name === "node" ? Option.some("/bin/node") : Option.none()),
        exists: (path) => path === "/pkg/src/cli.ts",
      }),
    )
    expect(launcher).toEqual({
      command: "/bin/node",
      args: ["--conditions=development", "/pkg/src/cli.ts"],
    })
  })
})
