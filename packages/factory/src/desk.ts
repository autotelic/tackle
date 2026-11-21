import { Data } from "effect"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { factoryHome } from "./store.ts"

/** A decision that waits for a human. One item, one home. */
export const DeskItem = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  kind: Schema.String,
  title: Schema.String,
  body: Schema.String,
  choices: Schema.Array(Schema.String),
  route: Schema.Literals(["slack", "github", "live"]),
  at: Schema.String,
})
export type DeskItem = typeof DeskItem.Type

/** A human answer; the first answer stands, later ones supersede it. */
export const DeskAnswer = Schema.Struct({
  item: Schema.String,
  choice: Schema.String,
  by: Schema.String,
  at: Schema.String,
  supersedes: Schema.optional(Schema.String),
})
export type DeskAnswer = typeof DeskAnswer.Type

/** A desk failure that carries its record kind rather than prose only. */
class DeskError extends Data.TaggedError("DeskError")<{ readonly detail: string }> {}

/**
 * The directory holding desk items and answers.
 *
 * @param home - the factory home.
 * @returns the desk directory.
 */
export const deskDir = (home: string = factoryHome()): string => join(home, "desk")
/**
 * The file for one desk item.
 *
 * @param input - the item id and optional home.
 * @returns the item path.
 */
export const deskItemFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(deskDir(input.home), input.id + ".json")
/**
 * The answer file for one desk item.
 *
 * @param input - the item id and optional home.
 * @returns the answer path.
 */
export const deskAnswerFile = (input: {
  readonly id: string
  readonly home?: string | undefined
}): string => join(deskDir(input.home), input.id + ".answer.json")

/** Raise one desk item outside every governed repo. */
export const raiseDesk = async (input: {
  readonly item: DeskItem
  readonly home?: string | undefined
}): Promise<void> => {
  await mkdir(deskDir(input.home), { recursive: true })
  await writeFile(
    deskItemFile({ id: input.item.id, home: input.home }),
    JSON.stringify(input.item, null, 2) + "\n",
  )
}

/** Read one desk item; malformed is a miss. */
export const readDesk = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<DeskItem | undefined> => {
  const text = await readFile(deskItemFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(DeskItem))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/** Answer one desk item; a second answer supersedes the first, never silently replaces it. */
export const answerDesk = async (input: {
  readonly answer: DeskAnswer
  readonly home?: string | undefined
}): Promise<void> => {
  const item = await readDesk({ id: input.answer.item, home: input.home })
  if (item === undefined)
    throw new DeskError({ detail: "desk item not found: " + input.answer.item })
  if (!item.choices.includes(input.answer.choice))
    throw new DeskError({ detail: "choice not offered: " + input.answer.choice })
  const previous = await readAnswer({ id: input.answer.item, home: input.home })
  await mkdir(deskDir(input.home), { recursive: true })
  await writeFile(
    deskAnswerFile({ id: input.answer.item, home: input.home }),
    JSON.stringify(
      previous === undefined ? input.answer : { ...input.answer, supersedes: previous.at },
      null,
      2,
    ) + "\n",
  )
}

/** Read a desk answer, if one exists. */
export const readAnswer = async (input: {
  readonly id: string
  readonly home?: string | undefined
}): Promise<DeskAnswer | undefined> => {
  const text = await readFile(deskAnswerFile(input), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const decoded = Schema.decodeResult(Schema.fromJsonString(DeskAnswer))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/** Every pending desk item. */
export const listDesk = async (input?: {
  readonly home?: string | undefined
}): Promise<ReadonlyArray<DeskItem>> => {
  const names = await readdir(deskDir(input?.home)).catch(() => [])
  const items: Array<DeskItem> = []
  for (const name of names.sort((left, right) => left.localeCompare(right))) {
    if (!name.endsWith(".json") || name.endsWith(".answer.json")) continue
    const item = await readDesk({ id: name.slice(0, -5), home: input?.home })
    if (item !== undefined && (await readAnswer({ id: item.id, home: input?.home })) === undefined)
      items.push(item)
  }
  return items
}
