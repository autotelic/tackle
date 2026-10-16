import type { Predicate } from "effect"
import type { SourceFile, Workspace } from "./workspace.ts"

/**
 * A composition bundle, as Pattern.md defines one.
 *
 * The pattern is a convention about FILES, not about declarations: a context, a
 * provider, one file per block, and an index that exports them under one name.
 * Every part of that convention is checkable from structure alone -- which call
 * a file makes, which element it renders, which keys an object literal has -- so
 * none of it needs a model, a renderer or a runtime.
 */
export interface Bundle {
  readonly dir: string
  /** PascalCase name derived from the directory, for messages. */
  readonly name: string
  readonly sources: ReadonlyArray<SourceFile>
  /** The file that calls `createContext`. The pattern's signature. */
  readonly contextFile: SourceFile | undefined
  /** The file that renders `*.Provider`. */
  readonly providerFile: SourceFile | undefined
  readonly indexFile: SourceFile | undefined
  /** Files that declare an exported component, other than index/context/provider. */
  readonly blocks: ReadonlyArray<SourceFile>
  /** Keys of the index's object literal, when it exports one. */
  readonly dotExportKeys: ReadonlyArray<string>
  /** Keys of the object passed to the context provider. */
  readonly providerValueKeys: ReadonlyArray<string> | undefined
  /** Declared names starting with `use`, the bundle's hook(s). */
  readonly hookNames: ReadonlyArray<string>
  /** Files that declare a `use*` name. */
  readonly hookFiles: ReadonlyArray<SourceFile>
}

/** The directory part of a path, or "." when there is none. */
export const dirOf = (file: string): string => {
  const cut = file.lastIndexOf("/")
  return cut === -1 ? "." : file.slice(0, cut)
}

/** The last segment of a path. */
export const baseOf = (file: string): string => {
  const cut = file.lastIndexOf("/")
  return cut === -1 ? file : file.slice(cut + 1)
}

/** `components/settings-dialog` -> `SettingsDialog`. */
export const bundleNameOf = (dir: string): string =>
  baseOf(dir)
    .split(/[-_.]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")

const calls = (file: SourceFile): ReadonlyArray<string> =>
  file.facts.callSites.map((site) => site.name)

/** Test files are not part of a bundle's surface. */
const isTest = (file: string): boolean => /\.(test|spec)\.[jt]sx?$/.test(file)

/**
 * A BLOCK is an exported component: PascalCase, therefore a thing you render.
 *
 * Counting every export made hooks and helpers into blocks, so `hooks.ts` was
 * reported as seven blocks in one file and a Remix `route.tsx` as three. Neither
 * is a violation of anything -- `useExpensesGroupedState` is not a block and
 * `loader` is not a block. Only components are.
 */
const isBlockName = (name: string): boolean => /^[A-Z][A-Za-z0-9_$]*$/.test(name)

/**
 * The names a file exports that read as composition blocks: functions named
 * with the block vocabulary, which is the producer half of the pattern.
 */
export const blocksIn = (file: SourceFile): ReadonlyArray<string> =>
  file.units
    .filter((unit) => unit.exported && unit.kind === "function" && isBlockName(unit.name))
    .map((unit) => unit.name)

const declares = (file: SourceFile): ReadonlyArray<string> =>
  file.units
    .filter((unit) => unit.exported && unit.kind === "function" && isBlockName(unit.name))
    .map((unit) => unit.name)

/** The object literal that looks like the index's dot-notation export. */
const dotExport = (file: SourceFile | undefined): ReadonlyArray<string> => {
  if (file === undefined) return []
  for (const keys of file.facts.objects.map((site) => site.keys)) {
    if (keys.includes("Provider")) return keys
  }
  return []
}

/**
 * The object literal that looks like the provider's context value.
 *
 * The best candidate wins rather than the first, because the value may be built
 * into a variable before it is passed: a provider whose literal sits above the
 * JSX was reported as passing no object at all. Picking the literal with the
 * most of state/actions/meta keeps that case conforming while still catching a
 * value that is genuinely missing a part.
 */
const providerValue = (file: SourceFile | undefined): ReadonlyArray<string> | undefined => {
  if (file === undefined) return undefined
  let best: ReadonlyArray<string> | undefined
  let score = 0
  for (const keys of file.facts.objects.map((site) => site.keys)) {
    const hits = TRIPARTITE.filter((key) => keys.includes(key)).length
    if (hits > score) {
      score = hits
      best = keys
    }
  }
  return score >= 2 ? best : undefined
}

const isIndex = (file: SourceFile): boolean => baseOf(file.path).startsWith("index.")

/**
 * Every directory that ATTEMPTS the composition pattern, as a bundle.
 *
 * A `createContext` call is the signal, but not the whole test: the directory
 * must also attempt the pattern -- a provider file, a `-provider` file, or an
 * index that dot-exports an object. A directory that merely calls
 * `createContext` is not measured as a bundle.
 */
export const findBundles = (workspace: Workspace): ReadonlyArray<Bundle> => {
  const byDir = new Map<string, Array<SourceFile>>()
  for (const file of workspace.files) {
    const dir = dirOf(file.path)
    const existing = byDir.get(dir)
    if (existing === undefined) byDir.set(dir, [file])
    else existing.push(file)
  }

  const bundles: Array<Bundle> = []
  for (const [dir, all] of byDir) {
    const files = all.filter((file) => !isTest(file.path))
    const contextFile = files.find((file) =>
      calls(file).some((call) => call === "createContext" || call.endsWith(".createContext")),
    )
    if (contextFile === undefined) continue

    const indexFile = files.find(isIndex)
    const providerFile = files.find((file) =>
      file.facts.jsx.some((element) => element.endsWith(".Provider")),
    )

    // A directory containing one `createContext` is not a composition bundle.
    // The pattern must be ATTEMPTED: a provider file by name, or an index that
    // exports an object with a `Provider` key. Without this, a plugin directory
    // that happened to call createContext was measured against all four rules
    // and reported as having no provider, no blocks and no hook.
    const attempts =
      providerFile !== undefined ||
      files.some((file) => /-provider\.[jt]sx?$/.test(baseOf(file.path))) ||
      dotExport(indexFile).length > 0
    if (!attempts) continue

    const blocks = files.filter(
      (file) =>
        file !== contextFile &&
        file !== providerFile &&
        !isIndex(file) &&
        declares(file).length > 0,
    )
    const hookNames = files.flatMap((file) =>
      file.units
        .filter((unit) => /^use[A-Z]/.test(unit.name) && unit.kind === "function")
        .map((unit) => unit.name),
    )

    bundles.push({
      dir,
      name: bundleNameOf(dir),
      sources: files,
      contextFile,
      providerFile,
      indexFile,
      blocks,
      dotExportKeys: dotExport(indexFile),
      providerValueKeys: providerValue(providerFile),
      hookNames,
      hookFiles: files.filter((file) =>
        file.units.some((unit) => unit.kind === "function" && /^use[A-Z]/.test(unit.name)),
      ),
    })
  }

  return bundles.sort((a, b) => (a.dir < b.dir ? -1 : 1))
}

/** A bundle's name, its dot-export key, and the name a block declares. */
interface KeyName {
  readonly bundleName: string
  readonly key: string
  readonly name: string
}

/**
 * Whether a declared name is the component an index key refers to.
 *
 * The pattern's index keys are the SHORT block names -- the spec's own
 * `Display`, not `GoodDisplay` -- so a direct string comparison flags every
 * conforming bundle. The declared name is the key, the key prefixed by the
 * bundle name, or the key as a suffix of it: the spec's `Settings.Provider`
 * maps to `SettingsProvider` and its `Counter.Display` to `CounterDisplay`.
 * The fixture caught this because the compliant bundle was reported as broken.
 */
export const keyMatchesName: Predicate.Predicate<KeyName> = ({ bundleName, key, name }) =>
  name === key || name === bundleName + key || name.endsWith(key)

/** Names the index promises that no block file declares. */
export const unexportedBlocks = (bundle: Bundle): ReadonlyArray<string> => {
  const declared = bundle.blocks.flatMap((file) => declares(file))
  return bundle.dotExportKeys.filter(
    (key) =>
      key !== "Provider" &&
      !/^use[A-Z]/.test(key) &&
      !declared.some((name) => keyMatchesName({ bundleName: bundle.name, key, name })),
  )
}

/** Block components the index never exports. */
export const orphanBlocks = (bundle: Bundle): ReadonlyArray<string> => {
  const names = bundle.blocks.flatMap((file) => declares(file))
  return names.filter(
    (name) => !bundle.dotExportKeys.some((key) => keyMatchesName({ bundleName: bundle.name, key, name })),
  )
}

/** The canonical tripartite shape, from Pattern.md. */
export const TRIPARTITE: ReadonlyArray<string> = ["state", "actions", "meta"]
