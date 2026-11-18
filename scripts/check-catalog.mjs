import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/*
 * One catalog, enforced.
 *
 * The workspace pins Effect, TypeScript, and the Oxc toolchain once in
 * `pnpm-workspace.yaml` and every package says `catalog:`. That is what makes "we are on the
 * latest versions" a fact about one file instead of a fact about twelve. A literal version
 * creeping back into a package.json is how the versions drift apart again, so this fails the
 * build when one appears.
 *
 * It does not check that the pins are the LATEST — that needs the network, and CI should not
 * depend on npm being reachable. It checks that there is exactly one place to update, so
 * "latest" stays a single deliberate edit (see `renovate.json` for the automated half).
 */

const WATCHED = [
  "effect",
  "@effect/ai-typesafe",
  "@effect/platform-node",
  "@effect/platform-node-shared",
  "@effect/vitest",
  "@effect/tsgo",
  "typescript",
  "@typescript/native",
  "@opencode/plugin",
  "@oxlint/plugins",
  "oxlint",
  "oxlint-tsgolint",
  "oxfmt",
  "oxc-parser",
  "pele",
  "vitest",
  "fast-check",
  "ajv",
  "@types/node",
]

const SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

/** Every workspace manifest this check reads, root first. */
const packageFiles = () => [
  "package.json",
  ...["packages", "tools", "examples"].flatMap((group) =>
    existsSync(group)
      ? readdirSync(group)
          .map((entry) => join(group, entry, "package.json"))
          .filter((file) => existsSync(file))
      : [],
  ),
]

/**
 * The exact pins the catalog declares, by package name.
 *
 * Only the `catalog:` block is read: `overrides` names the same packages, and an override is
 * the workspace's own tree, not a version a consumer could be asked to meet.
 */
const catalogPins = (workspace) => {
  const block = /^catalog:\n((?:[ \t]+.*\n?)*)/mu.exec(workspace)?.[1] ?? ""
  const pins = {}
  for (const line of block.split("\n")) {
    const match = /^\s+"?([^"\s:#]+)"?:\s*"?([^"\s#]+)"?/u.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) pins[match[1]] = match[2]
  }
  return pins
}

/**
 * The pins in one manifest that bypass the catalog.
 *
 * A peer range of `*` says "whatever the host provides", which is the point of an optional
 * peer. A peer range whose floor IS the catalog pin says "this package was tested at the
 * workspace's version and accepts the host's newer one" — the contract a shared runtime needs,
 * because two copies of Effect cannot talk to each other. Any other literal is a version that
 * escaped the catalog.
 */
const problemsIn = ({ file, manifest, pins }) =>
  SECTIONS.flatMap((section) => {
    const dependencies = manifest[section] ?? {}
    return WATCHED.flatMap((name) => {
      const value = dependencies[name]
      const pin = pins[name]
      const intentionalPeerRange =
        section === "peerDependencies" &&
        (value === "*" || (value !== undefined && pin !== undefined && value === `^${pin}`))
      return value !== undefined && value !== "catalog:" && !intentionalPeerRange
        ? [`${file}: ${section}.${name} is "${value}", not "catalog:"`]
        : []
    })
  })

/**
 * The watched packages the catalog does not name.
 *
 * A catalog entry is `name: "version"` under the `catalog:` key, possibly quoted.
 */
const missingFromCatalog = (workspace) => {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return WATCHED.filter((name) => {
    const pattern = new RegExp(`^\\s+"?${escape(name)}"?:\\s`, "mu")
    return !pattern.test(workspace)
  }).map((name) => `pnpm-workspace.yaml: no catalog entry for ${name}`)
}

/**
 * A package that publishes against `@effect/platform-node` must also declare the shared package
 * it re-exports.
 *
 * platform-node's only constraint on `@effect/platform-node-shared` is a caret, and the newer
 * minor imports a module `effect` 4.0.5 does not have. The workspace `overrides` hide that
 * locally; a dependency is what publishes. Without this line the published tool is a coin flip
 * in any consumer whose lockfile resolves the caret upward — which is exactly how `cutlist@0.0.2`
 * died on `effect/dist/process/CommandLine.js`.
 */
const missingSharedPin = ({ file, manifest }) => {
  const dependencies = manifest.dependencies ?? {}
  const usesPlatform = dependencies["@effect/platform-node"] !== undefined
  const pinsShared = dependencies["@effect/platform-node-shared"] === "catalog:"
  return usesPlatform && !pinsShared
    ? [
        `${file}: dependencies."@effect/platform-node" without dependencies."@effect/platform-node-shared": "catalog:"`,
      ]
    : []
}

const workspace = readFileSync("pnpm-workspace.yaml", "utf8")
const pins = catalogPins(workspace)
const manifests = packageFiles().map((file) => ({
  file,
  manifest: JSON.parse(readFileSync(file, "utf8")),
  pins,
}))

const problems = [
  ...manifests.flatMap(problemsIn),
  ...manifests.filter((entry) => entry.manifest.private !== true).flatMap(missingSharedPin),
  ...missingFromCatalog(workspace),
]

if (problems.length > 0) {
  process.stderr.write(
    "catalog check failed — these pins bypass the workspace catalog:\n" +
      problems.map((problem) => `  ${problem}`).join("\n") +
      "\n",
  )
  process.exit(1)
}

process.stdout.write(
  `catalog check: ${String(WATCHED.length)} pinned packages, all via the catalog\n`,
)
