import { Data } from "effect"
import { join } from "node:path"
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { workstreamDir } from "./store.ts"

/** One observed change the kernel has not consumed yet. */
export const Event = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  at: Schema.String,
  payload: Schema.Unknown,
  status: Schema.Literals(["pending", "consumed"]),
})
export type Event = typeof Event.Type

export class EventDecodeError extends Data.TaggedError("EventDecodeError")<{
  readonly path: string
  readonly detail: string
}> {}

/**
 * The append-only event log for one workstream.
 *
 * @param input - the workstream id and optional home.
 * @returns the JSONL path.
 */
export const eventFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(workstreamDir(input.home), input.id + ".events.jsonl")

/** Append one event; the log is the clock, so it is never rewritten on append. */
export const appendEvent = async (input: {
  readonly id: string
  readonly event: Event
  readonly home?: string | undefined
}): Promise<void> => {
  await mkdir(workstreamDir(input.home), { recursive: true })
  await appendFile(eventFile(input), JSON.stringify(input.event) + "\n")
}

/** Read the whole event log; a malformed line is a typed error, not a silent skip. */
export const readEvents = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<ReadonlyArray<Event>> => {
  const path = eventFile(input)
  const text = await readFile(path, "utf8").catch(() => undefined)
  if (text === undefined) return []
  const events: Array<Event> = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const decoded = Schema.decodeResult(Schema.fromJsonString(Event))(line)
    if (Result.isFailure(decoded))
      throw new EventDecodeError({ path, detail: String(decoded.failure) })
    events.push(decoded.success)
  }
  return events
}

/** Mark exactly these events consumed; a crash before this replays them. */
export const consumeEvents = async (input: {
  readonly id: string
  readonly ids: ReadonlyArray<string>
  readonly home?: string | undefined
}): Promise<void> => {
  const consumed = new Set(input.ids)
  const events = await readEvents(input)
  const text = events
    .map((event) =>
      JSON.stringify(consumed.has(event.id) ? { ...event, status: "consumed" } : event),
    )
    .join("\n")
  const path = eventFile(input)
  const temporary = path + ".tmp"
  await writeFile(temporary, text + (text === "" ? "" : "\n"))
  await rename(temporary, path)
}
