import { Effect, FileSystem, Option, Order, Path, Result, Schema, SchemaParser } from "effect"
import { decodeIntent, type CatalogComponent, type Intent } from "@autotelic/protocol"

/*
 * `intent/` — the authored half of the menu, one file per part, named for the part.
 *
 * The menu is the only mixed record in the artifact: composition is derived, and the
 * summary is written by a person. Keeping the written half in its own file is what lets
 * `cutlist build` regenerate the menu without ever touching a sentence someone wrote, and
 * what turns a rename into a visible stale file instead of silent deletion.
 *
 * The name is the key because `name` is the only identity a component carries today. When
 * stable ids land, this reader changes with `projectMenu` and nowhere else.
 */

/** The three ways authored intent can disagree with the tree. */
export interface IntentIssues {
  /** Intent files whose key names no part by id or name. */
  readonly stale: ReadonlyArray<string>
  /** `useInstead` targets that name no existing part or export. */
  readonly unknownTargets: ReadonlyArray<string>
  /** Deprecated parts with no migration target. */
  readonly stranded: ReadonlyArray<string>
}

/**
 * Check authored intent against the computed model.
 *
 * The menu can only join what exists; it cannot tell an author that the thing they wrote
 * about was renamed, or that the replacement they named never existed. These are the three
 * answers a person can act on, and they are reported rather than repaired: a tool that
 * guesses which part a stale sentence meant is worse than one that asks.
 */
export const validateIntent = ({
  byName,
  components,
}: {
  readonly byName: ReadonlyMap<string, Intent>
  readonly components: ReadonlyArray<CatalogComponent>
}): IntentIssues => {
  const keys = new Set<string>()
  const targets = new Set<string>()
  for (const component of components) {
    if (component.id !== undefined) keys.add(component.id)
    keys.add(component.name)
    targets.add(component.name)
    if (component.id !== undefined) targets.add(component.id)
    for (const name of component.exports ?? []) targets.add(name)
  }

  const stale: Array<string> = []
  const unknownTargets: Array<string> = []
  const stranded: Array<string> = []
  for (const [key, intent] of byName) {
    if (!keys.has(key)) stale.push(key)
    for (const target of intent.useInstead ?? []) {
      if (!targets.has(target)) unknownTargets.push(`${key} -> ${target}`)
    }
    if (intent.status === "deprecated" && (intent.useInstead?.length ?? 0) === 0) {
      stranded.push(key)
    }
  }
  return {
    stale: stale.sort(Order.String),
    unknownTargets: unknownTargets.sort(Order.String),
    stranded: stranded.sort(Order.String),
  }
}

/** One intent file as read: its basename (the key) and its text. */
export interface IntentFile {
  readonly name: string
  readonly text: string
}

/** The intent that decoded, keyed by part name, and the files that did not. */
export interface IntentSet {
  readonly byName: ReadonlyMap<string, Intent>
  /** Files that are not valid intent. Loud: authored data must not vanish quietly. */
  readonly malformed: ReadonlyArray<string>
}

/** Parse JSON without a throw, the way every other reader here treats untrusted bytes. */
const parseJson = (text: string): Option.Option<Schema.Json> =>
  Option.fromUndefinedOr(
    Result.getOrUndefined(SchemaParser.decodeResult(Schema.fromJsonString(Schema.Json))(text)),
  )

/**
 * Decode intent files. Pure, so the parser is tested without touching a disk.
 *
 * A non-JSON file or one that names neither a summary nor alternatives is a `malformed`
 * entry, not a silent miss: the caller decides whether to fail the build or ignore it.
 */
export const decodeIntentFiles = (files: ReadonlyArray<IntentFile>): IntentSet => {
  const byName = new Map<string, Intent>()
  const malformed: Array<string> = []
  for (const file of files) {
    if (!file.name.endsWith(".json")) continue
    const intent = Option.flatMap(parseJson(file.text), (value) =>
      Option.fromUndefinedOr(decodeIntent(value)),
    )
    if (Option.isNone(intent)) {
      malformed.push(file.name)
      continue
    }
    byName.set(file.name.slice(0, -".json".length), intent.value)
  }
  return { byName, malformed }
}

/**
 * Read every `*.json` under `directory`, relative to `root`.
 *
 * A missing directory is an empty set, not an error: a repo that has not written intent
 * yet is a repo where every entry is undocumented. Every other failure is swallowed to an
 * empty read; the menu is generated either way, and `--check` is the thing that must be
 * loud.
 */
export const readIntent = ({
  root,
  directory,
}: {
  readonly root: string
  readonly directory: string
}): Effect.Effect<IntentSet, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const absolute = path.resolve(root, directory)
    const exists = yield* Effect.orElseSucceed(fs.exists(absolute), () => false)
    if (!exists) return { byName: new Map(), malformed: [] }
    const entries = yield* Effect.orElseSucceed(fs.readDirectory(absolute), () => [])
    const files: Array<IntentFile> = []
    for (const name of [...entries].sort(Order.String)) {
      if (!name.endsWith(".json")) continue
      const text = yield* Effect.orElseSucceed(
        fs.readFileString(path.join(absolute, name)),
        () => "",
      )
      files.push({ name, text })
    }
    return decodeIntentFiles(files)
  })
