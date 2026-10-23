import { readFileSync } from "node:fs"
import { isRecord, str } from "@autotelic/board"

/*
 * The room config: `.room/config.json`, committed.
 *
 * It is the contract a second machine inherits — the Linear project, the repo, the stage,
 * the ingress mode, the review policy. Secrets and local paths never live here; those are
 * in `~/.room/` and in the environment. Read defensively (a malformed optional field
 * degrades), write strictly (one exact shape, pretty, newline).
 */

export const CONFIG_PATH = ".room/config.json"

export interface RoomConfig {
  readonly version: 1
  readonly room: string
  readonly name: string
  readonly stage: string
  readonly project: {
    readonly kind: "linear"
    readonly id: string
    readonly name: string
    readonly workspace?: string
  }
  readonly repo: {
    readonly owner: string
    readonly name: string
    readonly root: string
  }
  readonly ingress: {
    readonly github: "forward" | "poll"
    readonly linear: "poll" | "webhook"
  }
  readonly review: {
    readonly trigger: "review_requested"
    readonly provider: string
    readonly model: string
    readonly slots: number
  }
  readonly createdAt: string
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined

/** Read one config, or `undefined` when it is absent or says nothing usable. */
export const decodeConfig = (value: unknown): RoomConfig | undefined => {
  const root = record(value)
  if (root === undefined) return undefined
  const room = str(root.room)
  const name = str(root.name)
  const stage = str(root.stage)
  const createdAt = str(root.createdAt)
  const project = record(root.project)
  const repo = record(root.repo)
  const ingress = record(root.ingress)
  const review = record(root.review)
  if (room === undefined || name === undefined || stage === undefined) return undefined
  if (project === undefined || repo === undefined) return undefined
  const projectId = str(project.id)
  const projectName = str(project.name)
  const owner = str(repo.owner)
  const repoName = str(repo.name)
  const repoRoot = str(repo.root)
  if (
    projectId === undefined ||
    projectName === undefined ||
    owner === undefined ||
    repoName === undefined ||
    repoRoot === undefined
  ) {
    return undefined
  }
  const workspace = str(project.workspace)
  const github = str(ingress?.github)
  const linear = str(ingress?.linear)
  const provider = str(review?.provider) ?? "opencode-go"
  const model = str(review?.model) ?? "deepseek-v4.1-flash"
  const slots = typeof review?.slots === "number" ? Math.max(1, Math.trunc(review.slots)) : 1
  return {
    version: 1,
    room,
    name,
    stage,
    createdAt: createdAt ?? new Date().toISOString(),
    project: {
      kind: "linear",
      id: projectId,
      name: projectName,
      ...(workspace === undefined ? {} : { workspace }),
    },
    repo: { owner, name: repoName, root: repoRoot },
    ingress: {
      github: github === "poll" ? "poll" : "forward",
      linear: linear === "webhook" ? "webhook" : "poll",
    },
    review: { trigger: "review_requested", provider, model, slots },
  }
}

export const readConfig = (path: string): RoomConfig | undefined => {
  try {
    return decodeConfig(JSON.parse(readFileSync(path, "utf8")))
  } catch {
    return undefined
  }
}

/** One exact shape. The writer never emits a field the reader would have to guess at. */
export const encodeConfig = (config: RoomConfig): string => `${JSON.stringify(config, null, 2)}\n`
