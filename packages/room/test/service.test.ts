/* oxlint-disable plumb/prefer-property-tests -- one probe against one fixture server; each case pins which observation the socket earned. */
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { observeService, serviceUrl } from "../src/Service.ts"
import { readRoom, roomDir, roomFile, setRoomService, type RoomFile } from "../src/store.ts"

const T0 = 1_767_225_600_000
const at = "2026-11-22T12:00:00.000Z"
const web = { name: "web", command: "node server.js", healthPath: "/healthz" }

/** One answer a fixture server gives, with the headers a redirect needs. */
interface Answer {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
}

/** The one field the fixture needs from the socket's address answer. */
const BoundPort = Schema.Struct({ port: Schema.Int })

/** The port a listening socket bound; Node answers a unix socket with a path, and none here does. */
const boundPort = (server: Server): number => {
  const decoded = Schema.decodeUnknownResult(BoundPort)(server.address())
  return Result.isSuccess(decoded) ? decoded.success.port : 0
}

/** A loopback server that answers per path, on a port the kernel picks. */
const serve = async (
  answer: (path: string) => Answer,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> => {
  const server = createServer((request, response) => {
    const given = answer(request.url ?? "/")
    response.writeHead(given.status, { "content-type": "text/plain", ...given.headers })
    response.end("answer\n")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    port: boundPort(server),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe("a service's health is observed", () => {
  it("is healthy only on the health path's own 2xx answer", async () => {
    const server = await serve(() => ({ status: 200 }))
    try {
      const observed = await observeService({
        service: web,
        port: server.port,
        run: { pid: process.pid },
        checkedAt: at,
      })
      expect(observed).toEqual({
        name: "web",
        command: "node server.js",
        port: server.port,
        healthPath: "/healthz",
        status: "healthy",
        detail: null,
        checkedAt: at,
      })
    } finally {
      await server.close()
    }
  })

  it("asks the declared path, and a 404 on it is unhealthy evidence", async () => {
    const asked: Array<string> = []
    const server = await serve((path) => {
      asked.push(path)
      return { status: path === web.healthPath ? 200 : 404 }
    })
    try {
      const observed = await observeService({
        service: { ...web, healthPath: "/ready" },
        port: server.port,
        run: { pid: process.pid },
        checkedAt: at,
      })
      expect(asked).toEqual(["/ready"])
      expect(observed.status).toBe("unhealthy")
      expect(observed.detail).toBe("HTTP 404")
    } finally {
      await server.close()
    }
  })

  it("does not follow a redirect, because that 200 would be someone else's answer", async () => {
    const asked: Array<string> = []
    const server = await serve((path) => {
      asked.push(path)
      return path === "/ok" ? { status: 200 } : { status: 302, headers: { location: "/ok" } }
    })
    try {
      const observed = await observeService({
        service: web,
        port: server.port,
        run: { pid: process.pid },
        checkedAt: at,
      })
      expect(observed.status).toBe("unhealthy")
      expect(observed.detail).toBe("HTTP 302")
      expect(asked).toEqual(["/healthz"])
    } finally {
      await server.close()
    }
  })

  it("calls a live supervisor whose port answers nothing unhealthy, with the socket's reason", async () => {
    const server = await serve(() => ({ status: 200 }))
    const port = server.port
    await server.close()
    const observed = await observeService({
      service: web,
      port,
      run: { pid: process.pid },
      checkedAt: at,
    })
    expect(observed.status).toBe("unhealthy")
    expect(observed.detail).not.toBeNull()
  })

  it("calls a service with no supervisor record stopped, without opening a socket", async () => {
    const asked: Array<string> = []
    const server = await serve((path) => {
      asked.push(path)
      return { status: 200 }
    })
    try {
      const observed = await observeService({
        service: web,
        port: server.port,
        run: undefined,
        checkedAt: at,
      })
      expect(observed.status).toBe("stopped")
      expect(observed.detail).toBe("no supervisor is running for this room")
      expect(asked).toEqual([])
    } finally {
      await server.close()
    }
  })

  it("calls a service whose supervisor is gone stopped too", async () => {
    // A child that has exited: its pid is genuinely dead, so the record cannot be believed.
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
    const pid = child.pid ?? 0
    await new Promise<void>((resolve) => child.once("exit", () => resolve()))
    expect(pid).toBeGreaterThan(0)
    const observed = await observeService({ service: web, port: 1, run: { pid }, checkedAt: at })
    expect(observed.status).toBe("stopped")
  })

  it("asks loopback at the leased port and the declared path", () => {
    expect(serviceUrl({ port: 4400, healthPath: "/healthz" })).toBe("http://127.0.0.1:4400/healthz")
  })
})

/** A scratch shop root with the fixture writer bound to it. */
const scratch = async () => {
  const root = await mkdtemp(join(tmpdir(), "room-service-"))
  const fixture = async (id: string, extra: Partial<RoomFile> = {}): Promise<void> => {
    const state = { _tag: "Ready", repo: "/repo", scope: "dev", createdAt: T0 } as const
    const room: RoomFile = { id, base: "main", state, ...extra }
    await mkdir(roomDir({ root, id }), { recursive: true })
    await writeFile(roomFile({ root, id }), JSON.stringify(room, null, 2) + "\n")
  }
  return { root, fixture, close: () => rm(root, { recursive: true, force: true }) }
}

describe("a room declares one service", () => {
  it("records the declaration in the room file", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha")
      const saved = await setRoomService({ root, id: "alpha", service: web })
      expect(saved.ok && saved.value.service).toEqual(web)
      expect((await readRoom({ root, id: "alpha" }))?.service).toEqual(web)
      expect(JSON.parse(await readFile(roomFile({ root, id: "alpha" }), "utf8"))).toMatchObject({
        service: web,
      })
    } finally {
      await close()
    }
  })

  it("drops a plain exec, so one field names the command", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha", { exec: "pnpm dev" })
      await setRoomService({ root, id: "alpha", service: { ...web, command: "pnpm dev" } })
      const room = await readRoom({ root, id: "alpha" })
      expect(room?.exec).toBeUndefined()
      expect(room?.service?.command).toBe("pnpm dev")
    } finally {
      await close()
    }
  })

  it("leaves a room file with no service decodable, and no service", async () => {
    const { root, fixture, close } = await scratch()
    try {
      await fixture("alpha")
      expect((await readRoom({ root, id: "alpha" }))?.service).toBeUndefined()
    } finally {
      await close()
    }
  })

  it("refuses a room that does not exist", async () => {
    const { root, close } = await scratch()
    try {
      expect(await setRoomService({ root, id: "absent", service: web })).toEqual({
        ok: false,
        error: "RoomNotFound",
      })
    } finally {
      await close()
    }
  })
})
