#!/usr/bin/env node
// The installed entry point. It runs the build, never the source: Node refuses to strip
// types for files under node_modules, which is where this file lands once the package is
// installed. `pnpm jig` runs the source via the development condition.
//
// A linked checkout that was never built is the one case the build is absent. Name the
// command that fixes it instead of throwing ERR_MODULE_NOT_FOUND from the import below --
// otherwise an adopter's first five minutes go on reading that stack.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const built = join(root, "dist", "cli.js")

if (!existsSync(built)) {
  process.stderr.write(
    "jig: " + root + " has no dist/ -- run `pnpm build` in that checkout, then try again\n",
  )
  process.exit(1)
}

await import(built)
