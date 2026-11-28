#!/usr/bin/env node
// The installed entry point. It runs the build, never the source: Node refuses to strip
// types for files under node_modules, which is where this file lands once the package is
// installed. `pnpm standin` runs the source through the development condition.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const built = join(root, "dist", "cli.js")

if (!existsSync(built)) {
  process.stderr.write(
    "standin: " + root + " has no dist/ -- run `pnpm build` in that checkout, then try again\n",
  )
  process.exit(1)
}

await import(built)
