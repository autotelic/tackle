/* oxlint-disable plumb/prefer-property-tests -- the subject is one lease over a fixed fixture root; every case pins a refusal or a reclaim by name. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { portClaimFile, portRange, type PortLease } from "../src/PortLease.ts"
import {
  leaseRoomPort,
  readRoom,
  releaseRoomPort,
  roomDir,
  roomFile,
  type RoomFile,
} from "../src/store.ts"

const T0 = 1_767_225_600_000

/** A scratch shop root with the fixture writer bound to it. */
const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "room-port-"))
  /** A ready room on disk, written the way `room new` would leave it. */
  const fixture = async (id: string, port?: PortLease): Promise<void> => {
    const state = { _tag: "Ready", repo: "/repo", scope: "dev", createdAt: T0 } as const
    const room: RoomFile =
      port === undefined ? { id, base: "main", state } : { id, base: "main", state, port }
    await mkdir(roomDir({ root, id }), { recursive: true })
    await writeFile(roomFile({ root, id }), JSON.stringify(room, null, 2) + "\n")
  }
  return { root, fixture, close: () => rm(root, { recursive: true, force: true }) }
}

describe("a room leases one port", () => {
  it("leases the lowest free port and keeps it on a second ask", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha")
      const first = await leaseRoomPort({ root, id: "alpha", at: T0 })
      expect(first.ok && first.value.port).toEqual({ number: portRange.first, leasedAt: T0 })
      const again = await leaseRoomPort({ root, id: "alpha", at: T0 + 1 })
      expect(again.ok && again.value.port).toEqual({ number: portRange.first, leasedAt: T0 })
      // The claim file is the atomic half: the room file alone does not survive a race.
      expect(
        JSON.parse(await readFile(portClaimFile({ root, port: portRange.first }), "utf8")),
      ).toEqual({ room: "alpha", at: T0 })
    } finally {
      await close()
    }
  })

  it("steps past a port another room's file already names", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha", { number: portRange.first, leasedAt: T0 })
      await fixture("beta")
      const leased = await leaseRoomPort({ root, id: "beta", at: T0 })
      expect(leased.ok && leased.value.port?.number).toBe(portRange.first + 1)
    } finally {
      await close()
    }
  })

  it("steps past a live claim and reclaims a claim whose room is gone", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha")
      await mkdir(join(root, "ports"), { recursive: true })
      await writeFile(
        portClaimFile({ root, port: portRange.first }),
        JSON.stringify({ room: "deleted", at: T0 }),
      )
      const leased = await leaseRoomPort({ root, id: "alpha", at: T0 })
      expect(leased.ok && leased.value.port?.number).toBe(portRange.first)
      expect(
        JSON.parse(await readFile(portClaimFile({ root, port: portRange.first }), "utf8")),
      ).toEqual({ room: "alpha", at: T0 })
    } finally {
      await close()
    }
  })

  it("reclaims a malformed claim instead of refusing forever", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha")
      await mkdir(join(root, "ports"), { recursive: true })
      await writeFile(portClaimFile({ root, port: portRange.first }), "{")
      const leased = await leaseRoomPort({ root, id: "alpha", at: T0 })
      expect(leased.ok && leased.value.port?.number).toBe(portRange.first)
    } finally {
      await close()
    }
  })

  it("refuses when every port in the range is already leased", async () => {
    const { root, fixture, close } = await scratch()
    try {
      for (let index = 0; index <= portRange.last - portRange.first; index++) {
        await fixture("room-" + index, { number: portRange.first + index, leasedAt: T0 })
      }
      await fixture("late")
      expect(await leaseRoomPort({ root, id: "late", at: T0 })).toEqual({
        ok: false,
        error: "PortsExhausted",
      })
    } finally {
      await close()
    }
  })

  it("refuses a room that does not exist", async () => {
    const { root, close } = await scratch()
    try {
      expect(await leaseRoomPort({ root, id: "absent", at: T0 })).toEqual({
        ok: false,
        error: "RoomNotFound",
      })
    } finally {
      await close()
    }
  })
})

describe("a room releases its port", () => {
  it("removes the lease and the claim, so the next room may take it", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha")
      await fixture("beta")
      expect((await leaseRoomPort({ root, id: "alpha", at: T0 })).ok).toBe(true)
      const released = await releaseRoomPort({ root, id: "alpha" })
      expect(released.ok && released.value.port).toBeUndefined()
      expect((await readRoom({ root, id: "alpha" }))?.port).toBeUndefined()
      const again = await leaseRoomPort({ root, id: "beta", at: T0 + 1 })
      expect(again.ok && again.value.port?.number).toBe(portRange.first)
      expect(
        JSON.parse(await readFile(portClaimFile({ root, port: portRange.first }), "utf8")),
      ).toEqual({ room: "beta", at: T0 + 1 })
    } finally {
      await close()
    }
  })

  it("leaves a claim that names another room alone", async () => {
    const { root, fixture, close } = await scratch()
    try {
      // A fixture the allocator never produces: the room file and the claim disagree. Releasing
      // the file's owner must not hand the claim's owner's port away.
      await fixture("alpha", { number: portRange.first, leasedAt: T0 })
      await mkdir(join(root, "ports"), { recursive: true })
      await writeFile(
        portClaimFile({ root, port: portRange.first }),
        JSON.stringify({ room: "beta", at: T0 }),
      )
      const released = await releaseRoomPort({ root, id: "alpha" })
      expect(released.ok && released.value.port).toBeUndefined()
      expect(
        JSON.parse(await readFile(portClaimFile({ root, port: portRange.first }), "utf8")),
      ).toEqual({ room: "beta", at: T0 })
    } finally {
      await close()
    }
  })
})
