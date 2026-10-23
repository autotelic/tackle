import { isRecord } from "@autotelic/board"
import { linearTokenPresent } from "./gh.ts"
import { parseJson, run } from "./shell.ts"

/*
 * Linear, through `linearis`.
 *
 * The room does not own a Linear client. `linearis` is the person's tool, with the person's
 * token; the room asks it one question — which projects can this token see? — and records
 * the answer as a fact. When the token is absent, the plan says so and asks for a project
 * id instead of guessing.
 */

export interface LinearProject {
  readonly id: string
  readonly name: string
}

export const linearProjects = (): {
  readonly projects: ReadonlyArray<LinearProject>
  readonly note: string
} => {
  if (!linearTokenPresent()) {
    return { projects: [], note: "no Linear token at ~/.linearis/token" }
  }
  const result = run({ command: "linearis", args: ["projects", "list"], timeoutMs: 8_000 })
  if (result.code !== 0) {
    const stderr = parseJson(result.stderr.trim())
    const message =
      isRecord(stderr) && typeof stderr.error === "string"
        ? stderr.error
        : result.stderr.trim() || "linearis failed"
    return { projects: [], note: `linearis: ${message}` }
  }
  const value = parseJson(result.stdout)
  if (isRecord(value) && typeof value.error === "string") {
    return { projects: [], note: `linearis: ${value.error}` }
  }
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.projects)
      ? value.projects
      : []
  const projects = list.flatMap((entry): ReadonlyArray<LinearProject> => {
    if (!isRecord(entry)) return []
    const id = typeof entry.id === "string" ? entry.id : undefined
    const name = typeof entry.name === "string" ? entry.name : undefined
    if (id === undefined || name === undefined) return []
    return [{ id, name }]
  })
  return { projects, note: "" }
}
