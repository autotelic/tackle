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
 * The pins in one manifest that bypass the catalog.
 *
 * A peer range of `*` says "whatever the host provides", which is the point of an optional
 * peer; only a pinned literal is a version that escaped the catalog.
 */
const problemsIn = ({ file, manifest }) =>
  SECTIONS.flatMap((section) => {
    const dependencies = manifest[section] ?? {}
    return WATCHED.flatMap((name) => {
      const value = dependencies[name]
      const intentionalPeerRange = section === "peerDependencies" && value === "*"
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

const problems = [
  ...packageFiles().flatMap((file) =>
    problemsIn({ file, manifest: JSON.parse(readFileSync(file, "utf8")) }),
  ),
  ...missingFromCatalog(readFileSync("pnpm-workspace.yaml", "utf8")),
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
