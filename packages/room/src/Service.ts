import { request } from "node:http"
import * as Schema from "effect/Schema"
import { alive, type RoomRun } from "./run.ts"

/**
 * One declared service on a room.
 *
 * A room declares at most one, and the declaration names no port. The room's own lease already
 * names the number the service listens on (`port` sits beside this declaration in the same
 * file), so a number written here could disagree with the lease and make two owners for the one
 * port the lease exists to fence.
 *
 * `health` is a path on the room's own port, never a URL: a URL would let one room probe an
 * origin its lease does not own, which is the collision the lease prevents.
 */
export const ServiceDecl = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  health: Schema.String,
})
export type ServiceDecl = typeof ServiceDecl.Type

/** Whether a health path is one this room may probe: a path on its own port, not an origin. */
export const isHealthPath = (value: string): boolean =>
  value.startsWith("/") && !value.startsWith("//")

/** The states a probe can report. There is no "probably fine": health is only what was answered. */
export const ServiceHealthState = Schema.Union([
  Schema.Literal("healthy"),
  Schema.Literal("unhealthy"),
  Schema.Literal("unknown"),
])
export type ServiceHealthState = typeof ServiceHealthState.Type

/**
 * What one look at the service found, and when the room looked.
 *
 * `checkedAt` is the moment of the look, including the case where there was nothing to look
 * at: an `unknown` state is an observation of its own, not the absence of one. Every state that
 * is not `healthy` carries a `detail`, so a reader never has to guess why.
 */
export const ServiceHealth = Schema.Struct({
  path: Schema.String,
  state: ServiceHealthState,
  status: Schema.optional(Schema.Int),
  detail: Schema.optional(Schema.String),
  checkedAt: Schema.Int,
})
export type ServiceHealth = typeof ServiceHealth.Type

/** One service as the room reports it: the declaration, its port, and the health it was found in. */
export const ServiceStatus = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  port: Schema.NullOr(Schema.Int),
  health: ServiceHealth,
})
export type ServiceStatus = typeof ServiceStatus.Type

/** How long one probe may take. The board runs it on every /presence, so it is short. */
export const healthTimeoutMs = 500

/**
 * Ask the service on one port for its health path.
 *
 * A 2xx answer is `healthy` and nothing else is. An answer outside 2xx, a refused connection or
 * a silent port is `unhealthy` with the reason. `node:http` is used directly rather than
 * `fetch` because each probe is one connection that dies with the answer: no keep-alive pool
 * outlives the /presence request that started it, and no body can hold the page open.
 *
 * @param input - the port, the health path, and the budget for one answer.
 * @returns the observed health; a refused or silent port is a finding, not an exception.
 */
export const probeHealth = (input: {
  readonly port: number
  readonly path: string
  readonly timeoutMs?: number | undefined
  readonly at?: number | undefined
}): Promise<ServiceHealth> => {
  const at = input.at ?? Date.now()
  const timeoutMs = input.timeoutMs ?? healthTimeoutMs
  const path = input.path
  return new Promise((resolve) => {
    let settled = false
    const finish = (health: ServiceHealth): void => {
      if (settled) return
      settled = true
      resolve(health)
    }
    const unhealthy = (detail: string, status?: number): void =>
      finish(
        status === undefined
          ? { path, state: "unhealthy", detail, checkedAt: at }
          : { path, state: "unhealthy", status, detail, checkedAt: at },
      )
    const call = request(
      {
        host: "127.0.0.1",
        port: input.port,
        path,
        method: "GET",
        // One connection per probe, closed with the answer.
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0
        // The status line is the observation; the body is discarded unseen.
        response.resume()
        if (status >= 200 && status < 300) finish({ path, state: "healthy", status, checkedAt: at })
        else unhealthy("answered " + status, status)
      },
    )
    call.on("timeout", () => {
      unhealthy("no answer in " + timeoutMs + "ms")
      call.destroy()
    })
    // SAFETY: a refused or reset connection is the case this probe exists for; it is a finding.
    call.on("error", (cause: Error) => unhealthy(cause.message))
    call.end()
  })
}

/** The part of a room's file a service report needs: its declaration and its leased port. */
export interface ServiceHost {
  readonly service?: ServiceDecl | undefined
  readonly port?: { readonly number: number } | undefined
}

/**
 * Observe the one service a room declares, if it declares one.
 *
 * Nothing is cached and nothing is inferred. A room that declares no service reports nothing at
 * all; a room that declares one and holds no port, or is not running, reports `unknown` with the
 * reason instead of a health state nobody observed. Only a live probe that answered 2xx reports
 * `healthy`.
 *
 * @param input - the room's declaration and lease, its run record, and the probe budget.
 * @returns the service status, or undefined when the room declares no service.
 */
export const observeRoomService = async (input: {
  readonly room: ServiceHost
  readonly run: { readonly pid: number } | undefined
  readonly timeoutMs?: number | undefined
  readonly at?: number | undefined
}): Promise<ServiceStatus | undefined> => {
  const declared = input.room.service
  if (declared === undefined) return undefined
  const at = input.at ?? Date.now()
  const port = input.room.port?.number ?? null
  const base = { name: declared.name, command: declared.command, port }
  if (port === null)
    return {
      ...base,
      health: {
        path: declared.health,
        state: "unknown",
        detail: "the room holds no port",
        checkedAt: at,
      },
    }
  if (input.run === undefined || !alive(input.run.pid))
    return {
      ...base,
      health: {
        path: declared.health,
        state: "unknown",
        detail: "the room is not up",
        checkedAt: at,
      },
    }
  return {
    ...base,
    health: await probeHealth({ port, path: declared.health, timeoutMs: input.timeoutMs, at }),
  }
}

/**
 * The room-file declaration used by the CLI and store. The probe implementation below
 * works on the richer ServiceDecl; this is the stable persisted shape.
 */
export const ServiceDeclaration = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  healthPath: Schema.String,
})
export type ServiceDeclaration = typeof ServiceDeclaration.Type

/** The flat observation the board and room status consumed before the probe was split out. */
export interface ServiceObservation {
  readonly name: string
  readonly command: string
  readonly port: number
  readonly healthPath: string
  readonly status: "healthy" | "unhealthy" | "stopped"
  readonly detail: string | null
  readonly checkedAt: string
}

export const probeTimeoutMs = healthTimeoutMs

export const serviceUrl = (input: { readonly port: number; readonly healthPath: string }): string =>
  "http://127.0.0.1:" + input.port + input.healthPath

/** Compatibility entry point: observe a persisted declaration through the new probe. */
export const observeService = async (input: {
  readonly service: ServiceDeclaration
  readonly port: number
  readonly run: { readonly pid: number } | undefined
  readonly checkedAt: string
}): Promise<ServiceObservation> => {
  const observed = await observeRoomService({
    room: {
      service: {
        name: input.service.name,
        command: input.service.command,
        health: input.service.healthPath,
      },
      port: { number: input.port },
    },
    run: input.run,
    at: Date.parse(input.checkedAt),
  })
  if (observed === undefined) throw new Error("service declaration disappeared")
  const status =
    observed.health.state === "healthy"
      ? "healthy"
      : observed.health.state === "unknown" && observed.health.detail === "the room is not up"
        ? "stopped"
        : "unhealthy"
  const detail =
    status === "stopped"
      ? "no supervisor is running for this room"
      : observed.health.detail?.startsWith("answered ")
        ? "HTTP " + observed.health.detail.slice("answered ".length)
        : (observed.health.detail ?? null)
  return {
    name: input.service.name,
    command: input.service.command,
    port: input.port,
    healthPath: input.service.healthPath,
    status,
    detail,
    checkedAt: input.checkedAt,
  }
}
