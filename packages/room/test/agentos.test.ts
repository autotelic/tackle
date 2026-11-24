/* oxlint-disable plumb/prefer-property-tests -- one real sidecar process, two fixed VMs; the assertion is isolation. */
import { Effect } from "effect"
import { expect, test } from "vitest"
import { createAgentOsRoom } from "../src/AgentOs.ts"

const create = (id: string) => Effect.runPromise(createAgentOsRoom({ id }))

test("two embedded agentOS rooms have separate filesystems and processes", async () => {
  const a = await create("permissions-dog")
  const b = await create("enterprise-dog")
  try {
    await a.vm.filesystem.writeFile("/workspace/who.txt", "permissions\n")
    await b.vm.filesystem.writeFile("/workspace/who.txt", "enterprise\n")

    const readA = await a.vm.process.exec("cat /workspace/who.txt", {
      output: { capture: "all" },
    })
    const readB = await b.vm.process.exec("cat /workspace/who.txt", {
      output: { capture: "all" },
    })
    expect(readA.stdout).toBe("permissions\n")
    expect(readB.stdout).toBe("enterprise\n")

    await a.vm.filesystem.writeFile("/workspace/only-a.txt", "a\n")
    expect(await a.vm.filesystem.exists("/workspace/only-a.txt")).toBe(true)
    expect(await b.vm.filesystem.exists("/workspace/only-a.txt")).toBe(false)
  } finally {
    await a.dispose()
    await b.dispose()
  }
}, 60_000)
