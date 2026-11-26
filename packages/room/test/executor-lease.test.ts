/* oxlint-disable plumb/prefer-property-tests -- one lease fixture; the assertion is expiry and refusal. */
import { expect, test } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ExecutorLeaseError, readExecutorLease } from "../src/ExecutorLease.ts"

const lease = (expiresAt: string) => ({
  version: 1,
  workstream: "tackle-agent-os",
  issuedAt: "2026-11-26T00:00:00.000Z",
  expiresAt,
  credentials: [{ id: "github", kind: "github" }],
  env: { GH_TOKEN: "secret" },
})

test("a lease carries the workstream environment until it expires", async () => {
  const root = await mkdtemp(join(tmpdir(), "room-lease-"))
  const path = join(root, "lease.json")
  try {
    await writeFile(path, JSON.stringify(lease("2026-11-26T00:15:00.000Z")))
    const read = await readExecutorLease(path, Date.parse("2026-11-26T00:10:00.000Z"))
    expect(read.workstream).toBe("tackle-agent-os")
    expect(read.env).toEqual({ GH_TOKEN: "secret" })
    await expect(
      readExecutorLease(path, Date.parse("2026-11-26T00:15:00.000Z")),
    ).rejects.toMatchObject({ _tag: "ExecutorLeaseExpired" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a missing lease is a refusal, not an empty environment", async () => {
  await expect(
    readExecutorLease("/tmp/does-not-exist-lease.json", Date.now()),
  ).rejects.toBeInstanceOf(ExecutorLeaseError)
})
