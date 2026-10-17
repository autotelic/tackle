import { spawn } from "node:child_process"

/*
 * One child conversation. This is the `hands` instrument from FOREMAN §4:
 *
 *   opencode2 run --session <id> --format json --auto --agent <role> --model <model> <task>
 *
 * A new session is created when no id is given; the stream carries the `sessionID`, so the
 * parent can continue or `--fork` it later. The model is the same for every member (§6) —
 * differentiation is the brief and the evidence, never the weights.
 *
 * This is the one place the harness spends money, and it is deliberately the only place that
 * spawns anything: the budget governor gates it, the store records it, and a crash mid-run
 * leaves the task `running` so the next start reports it rather than repeating it.
 */

/**
 * The two ways to reach the one model (§9). The free line goes first because it is the one to
 * exhaust; both are `deepseek-v4.1-flash`, so the choice is quota, never capability.
 */
export const MODEL_FREE = "opencode/deepseek-v4.1-flash-free"
export const MODEL_GO = "opencode-go/deepseek-v4.1-flash"

export interface DispatchOptions {
  readonly prompt: string
  readonly title: string
  readonly model: string
  readonly agent?: string
  readonly cwd?: string
  readonly timeoutMs?: number
  /** Called for each parsed stream event, for live logging. */
  readonly onEvent?: (event: Record<string, unknown>) => void
}

export interface ChildRun {
  readonly sessionID: string
  /** The concatenated assistant text — the conversation's answer. */
  readonly text: string
  readonly events: number
  readonly code: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/** Pull the assistant text out of a stream part, when the part is one. */
const textOf = (event: Record<string, unknown>): string => {
  const part = event.part
  if (!isRecord(part)) return ""
  if (part.type !== "text") return ""
  return typeof part.text === "string" ? part.text : ""
}

/** Run one child conversation to completion, streaming JSONL back. */
export const dispatchChild = (options: DispatchOptions): Promise<ChildRun> =>
  new Promise((resolve) => {
    const args = [
      "run",
      "--title",
      options.title,
      "--format",
      "json",
      "--auto",
      ...(options.agent === undefined ? [] : ["--agent", options.agent]),
      "--model",
      options.model,
      options.prompt,
    ]
    const child = spawn("opencode2", args, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    })

    let sessionID = ""
    let text = ""
    let events = 0
    let buffer = ""

    const consume = (line: string): void => {
      const trimmed = line.trim()
      if (trimmed === "") return
      let event: unknown
      try {
        event = JSON.parse(trimmed)
      } catch {
        return
      }
      if (!isRecord(event)) return
      events += 1
      if (typeof event.sessionID === "string" && event.sessionID !== "") {
        sessionID = event.sessionID
      }
      text += textOf(event)
      options.onEvent?.(event)
    }

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) consume(line)
    })

    let timer: NodeJS.Timeout | undefined
    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs)
    }

    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer)
      consume(buffer)
      resolve({ sessionID, text, events, code: code ?? -1 })
    })
    child.on("error", () => {
      if (timer !== undefined) clearTimeout(timer)
      resolve({ sessionID, text, events, code: -1 })
    })
  })
