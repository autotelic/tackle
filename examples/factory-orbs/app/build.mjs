import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

/*
 * The factory's build step. It reads the worktree's own state and writes the one artifact the
 * server serves. Nothing is shared with the sibling factory: each container builds its own
 * /app, and the two worktrees never see each other's files.
 */
export const readState = async () =>
  JSON.parse(await readFile(join(process.cwd(), "src", "state.json"), "utf8"))

export const readWorktree = async () =>
  JSON.parse(await readFile(join(process.cwd(), "src", "worktree.json"), "utf8"))

const escape = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const build = async () => {
  const state = await readState()
  const worktree = await readWorktree()
  const template = await readFile(join(process.cwd(), "src", "template.html"), "utf8")
  const builtAt = new Date().toISOString()
  const html = template
    .replaceAll("__FACTORY__", escape(process.env.FACTORY_ID ?? "factory"))
    .replaceAll("__BRANCH__", escape(worktree.branch))
    .replaceAll("__HEAD__", escape(worktree.head))
    .replaceAll("__SOURCE_HEAD__", escape(worktree.sourceHead))
    .replaceAll("__NOTE__", escape(state.note))
    .replaceAll("__REVISION__", escape(state.revision))
    .replaceAll("__BUILD_AT__", escape(builtAt))
    .replaceAll("__INTERNAL_PORT__", escape(process.env.PORT ?? "4400"))
  await mkdir(join(process.cwd(), "public"), { recursive: true })
  await writeFile(join(process.cwd(), "public", "index.html"), html)
  return { factory: process.env.FACTORY_ID ?? "factory", builtAt, ...state, ...worktree }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const summary = await build()
  console.log(
    JSON.stringify({ built: summary.factory, revision: summary.revision, branch: summary.branch }),
  )
}
