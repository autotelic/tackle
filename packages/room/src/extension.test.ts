/* oxlint-disable plumb/prefer-property-tests -- the subject is a host contract with exactly two cases (a second install, a reload); a generator would be inventing host states. */
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

/*
 * A duplicate install must not take the boot down.
 *
 * pi loads extensions per scope, so the same package can be present twice: a user-scope
 * checkout and a project's own dependency. Both register `room_*` under the same names, and
 * pi refuses the second registration -- one load error per tool instead of a working surface.
 * These two cases are the whole contract: a DIFFERENT path means a second install and yields
 * no registrations; this file's own path means a reload and must still register.
 */

/** The registry entry pi hands back from `getAllTools`, narrowed to what the guard reads. */
interface HostTool {
  readonly name: string
  readonly sourceInfo?: { readonly path?: string }
}

/** The host surface the factory touches while loading; nothing here is called by the guard. */
interface Host {
  readonly getAllTools: () => ReadonlyArray<HostTool>
  readonly registerTool: (tool: { readonly name: string }) => void
  readonly registerCommand: () => void
  readonly on: () => void
  readonly getSessionName: () => string
  readonly setSessionName: () => void
  readonly sendMessage: () => void
}

type Factory = (pi: Host) => void

const load = async (): Promise<Factory> => {
  const url = new URL("../extensions/pi.ts", import.meta.url).href
  // SAFETY: the extension's export shape -- one default factory taking the host -- is what the
  // dynamic import yields; the module is deliberately outside the compiler's program, so its
  // type is not available here and the runtime contract is asserted by the two cases below.
  const module = (await import(/* @vite-ignore */ url)) as { readonly default: Factory }
  return module.default
}

/** A host that records registrations and answers `getAllTools` with what is already there. */
const host = (registered: Array<string>, tools: ReadonlyArray<HostTool>): Host => ({
  getAllTools: () => tools,
  registerTool: (tool) => {
    registered.push(tool.name)
  },
  registerCommand: () => undefined,
  on: () => undefined,
  getSessionName: () => "unnamed",
  setSessionName: () => undefined,
  sendMessage: () => undefined,
})

describe("the room extension and a second install", () => {
  it("registers nothing when another install already holds its tool names", async () => {
    const registered: Array<string> = []
    const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const extension = await load()
    extension(
      host(registered, [
        {
          name: "room_board",
          sourceInfo: { path: "/elsewhere/node_modules/@autotelic/room/extensions/pi.ts" },
        },
      ]),
    )
    expect(registered).toEqual([])
    // The skip must say which file it left out, or the person has no way to settle ownership.
    expect(warned).toHaveBeenCalledOnce()
    expect(String(warned.mock.calls[0]?.[0])).toContain("already registered by")
    warned.mockRestore()
  })

  it("still registers when the tools are its own, which is a reload", async () => {
    const registered: Array<string> = []
    const self = fileURLToPath(new URL("../extensions/pi.ts", import.meta.url))
    const extension = await load()
    extension(host(registered, [{ name: "room_board", sourceInfo: { path: self } }]))
    expect(registered.length).toBeGreaterThan(0)
    expect(registered).toContain("room_board")
  })
})
