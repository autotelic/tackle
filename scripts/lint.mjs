import { spawnSync } from "node:child_process"

/*
 * The workspace lint command, with one place for its flags.
 *
 * `joggle remedies` needs oxlint's JSON, and asking for it by re-typing this
 * command's twelve ignore patterns would let the two drift. The flags live here;
 * `pnpm lint` runs the default format and `pnpm lint:json` runs the same analysis
 * with the machine-readable one.
 */

const lintArgs = (format) => {
  const args = [
    "--ignore-pattern",
    "examples/**",
    "--ignore-pattern",
    "packages/plumb/**",
    "--ignore-pattern",
    "packages/joggle/**",
    "--ignore-pattern",
    "tools/**",
  ]
  if (format !== undefined) args.push("--format", format)
  args.push(
    "packages/protocol",
    "packages/cutlist",
    "packages/jig-cli",
    "packages/room",
    "packages/board",
    "packages/board/view",
    "scripts",
    "oxlint.config.ts",
  )
  return args
}

const formatAt = process.argv.indexOf("--format")
const format = formatAt === -1 ? undefined : (process.argv[formatAt + 1] ?? "default")
const result = spawnSync("oxlint", lintArgs(format), { stdio: "inherit" })
process.exit(result.status ?? 1)
