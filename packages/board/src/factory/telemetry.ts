import { readFile, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/** One factory session's measured cost and operation mix. */
export interface SessionTelemetry {
  readonly session: string
  readonly workstream: string
  readonly startedAt: string
  readonly endedAt: string
  readonly wallSeconds: number
  readonly modelSeconds: number
  readonly toolSeconds: number
  readonly turns: number
  readonly toolCalls: number
  readonly measurementCalls: number
  readonly editCalls: number
  readonly commits: number
  readonly pushes: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly costUsd: number
}

const sessionsDir = (home: string = join(homedir(), ".factory")): string => join(home, "sessions")

const workstreamOf = (session: string): string => {
  const name = session.replace(/^factory-/u, "")
  const match = name.match(/^(.+?)-\d{8}T\d{6}Z$/u)
  return match?.[1] ?? name
}

const number = (value: unknown): number => (typeof value === "number" ? value : 0)
const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

/** Parse one Pi session log. A malformed line is skipped: telemetry is an observation, not a gate. */
export const telemetryOfSession = (input: {
  readonly session: string
  readonly text: string
}): SessionTelemetry | undefined => {
  let startedAt: string | undefined
  let endedAt: string | undefined
  let modelMs = 0
  let toolMs = 0
  let turns = 0
  let toolCalls = 0
  let measurementCalls = 0
  let editCalls = 0
  let commits = 0
  let pushes = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let costUsd = 0

  for (const line of input.text.split("\n")) {
    if (line.trim() === "") continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== "object" || entry === null) continue
    const record = entry as Record<string, unknown>
    const timestamp = textOf(record.timestamp)
    if (timestamp !== "") {
      startedAt ??= timestamp
      endedAt = timestamp
    }
    if (record.type !== "message") continue
    const message = record.message
    if (typeof message !== "object" || message === null) continue
    const body = message as Record<string, unknown>
    if (body.role === "toolResult") {
      toolMs += number(body.durationMs)
      continue
    }
    if (body.role !== "assistant") continue
    turns += 1
    modelMs += number(body.durationMs)
    const usage = body.usage
    if (typeof usage === "object" && usage !== null) {
      const used = usage as Record<string, unknown>
      inputTokens += number(used.input)
      outputTokens += number(used.output)
      cacheReadTokens += number(used.cacheRead)
      const cost = used.cost
      if (typeof cost === "object" && cost !== null)
        costUsd += number((cost as Record<string, unknown>).total)
    }
    const content = body.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue
      const call = part as Record<string, unknown>
      if (call.type !== "toolCall") continue
      toolCalls += 1
      const args = call.arguments
      const code =
        typeof args === "object" && args !== null
          ? textOf((args as Record<string, unknown>).code)
          : ""
      if (code.includes("jig check") || code.includes("joggle")) measurementCalls += 1
      if (code.includes("pi.edit") || code.includes("pi.write")) editCalls += 1
      if (code.includes("git commit")) commits += 1
      if (code.includes("git push")) pushes += 1
    }
  }

  if (startedAt === undefined || endedAt === undefined) return undefined
  return {
    session: input.session,
    workstream: workstreamOf(
      input.session
        .replace(/\.jsonl$/u, "")
        .split("_factory-")
        .at(-1) ?? input.session,
    ),
    startedAt,
    endedAt,
    wallSeconds: Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)),
    modelSeconds: Math.round(modelMs / 1000),
    toolSeconds: Math.round(toolMs / 1000),
    turns,
    toolCalls,
    measurementCalls,
    editCalls,
    commits,
    pushes,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd: Math.round(costUsd * 10000) / 10000,
  }
}

/** Read recent factory sessions; `since` is inclusive, so a retry window is deterministic. */
export const readTelemetry = async (input?: {
  readonly home?: string | undefined
  readonly since?: string | undefined
}): Promise<ReadonlyArray<SessionTelemetry>> => {
  const directory = sessionsDir(input?.home)
  const names = (await readdir(directory).catch(() => []))
    .filter((name) => name.endsWith(".jsonl") && name.includes("_factory-"))
    .sort((left, right) => left.localeCompare(right))
  const since = input?.since === undefined ? undefined : Date.parse(input.since)
  const sessions: Array<SessionTelemetry> = []
  for (const name of names) {
    const text = await readFile(join(directory, name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    const session = telemetryOfSession({ session: name, text })
    if (session === undefined) continue
    if (since !== undefined && Date.parse(session.startedAt) < since) continue
    sessions.push(session)
  }
  return sessions
}
