import { actorOf, roomOf, stageOf } from "@autotelic/board"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { RoomClient } from "./client.ts"
import { CONFIG_PATH, type RoomConfig, encodeConfig, readConfig } from "./config.ts"
import { roomUrl } from "./daemon.ts"
import { authLogin, linearTokenPresent } from "./gh.ts"
import { repoOf, topLevel } from "./git.ts"
import { linearProjects } from "./linear.ts"
import { configPathOf, readIndex, recordRoom } from "./paths.ts"
import { onPath, run } from "./shell.ts"

/*
 * The commands behind `jig room`.
 *
 * `plan` is read-only and ends with the exact `init` it would run; `init` applies it; `doctor`
 * proves the loop. That is the same shape as `jig onboard` / `jig init`, because the person
 * approving a plan should not have to re-derive it from flags.
 */

export interface Plan {
  readonly root: string
  readonly repo: string | undefined
  readonly login: string | undefined
  readonly authenticated: boolean
  readonly linearToken: boolean
  readonly linear: ReadonlyArray<{ id: string; name: string }>
  readonly linearNote: string
  readonly config: RoomConfig | undefined
  readonly rooms: ReadonlyArray<{ room: string; name: string; stage: string; lastSeen: number }>
}

export const plan = (cwd: string): Plan => {
  const root = topLevel(cwd) ?? cwd
  const repo = repoOf(root)
  const login = authLogin()
  const linear = linearProjects()
  return {
    root,
    repo: repo === undefined ? undefined : `${repo.owner}/${repo.name}`,
    login,
    authenticated: login !== undefined,
    linearToken: linearTokenPresent(),
    linear: linear.projects,
    linearNote: linear.note,
    config: readConfig(configPathOf(root)),
    rooms: readIndex().rooms.map(({ room, name, stage, lastSeen }) => ({
      room,
      name,
      stage,
      lastSeen,
    })),
  }
}

const ago = (at: number): string => {
  if (at === 0) return "never"
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export const renderPlan = (value: Plan): string => {
  const lines: Array<string> = ["room · plan", ""]
  lines.push(`  repo      ${value.repo ?? "(no origin remote)"}`)
  lines.push(`  root      ${value.root}`)
  lines.push(`  github    ${value.login ?? "(gh not authenticated)"}`)
  lines.push(
    `  linear    ${value.linearToken ? `${value.linear.length} project(s)` : "no token at ~/.linearis/token"}`,
  )
  if (value.linearNote !== "") lines.push(`            ${value.linearNote}`)
  lines.push(`  stage     ${value.login === undefined ? "local/<login>" : stageOf(value.login)}`)
  lines.push("")
  if (value.config !== undefined) {
    lines.push(`  existing  ${value.config.name} · ${value.config.room}`)
  } else {
    lines.push("  existing  no .room/config.json in this repo")
  }
  if (value.rooms.length > 0) {
    lines.push("")
    lines.push("  rooms")
    for (const room of value.rooms.slice(0, 8)) {
      lines.push(`    ${room.name.padEnd(22)} ${room.stage.padEnd(18)} ${ago(room.lastSeen)}`)
    }
  }
  lines.push("")
  lines.push("  questions")
  lines.push("    1. room name?          e.g. multi-season")
  lines.push(
    `    2. linear project?     ${value.linear[0]?.name ?? "a project id from `linearis projects list`"}`,
  )
  lines.push(
    `    3. stage?              ${value.login === undefined ? "local/<login>" : stageOf(value.login)}`,
  )
  lines.push("")
  lines.push("  next")
  lines.push(
    `    jig room init --room <name> --linear-project <id> --linear-name "<name>"` +
      (value.login === undefined ? "" : ` --stage ${stageOf(value.login)}`),
  )
  return lines.join("\n")
}

export interface InitOptions {
  readonly cwd: string
  readonly name: string
  readonly projectId: string
  readonly projectName: string
  readonly workspace: string | undefined
  readonly stage: string | undefined
  readonly force: boolean
}

export const init = async (
  options: InitOptions,
): Promise<{
  readonly config: RoomConfig
  readonly path: string
  readonly configured: boolean
}> => {
  const root = topLevel(options.cwd) ?? options.cwd
  const login = authLogin()
  if (login === undefined) throw new Error("gh is not authenticated; run `gh auth login`")
  const repo = repoOf(root)
  if (repo === undefined) throw new Error("no GitHub origin remote in this repository")
  const path = configPathOf(root)
  if (existsSync(path) && !options.force) {
    throw new Error(`${CONFIG_PATH} already exists; pass --force to rewrite it`)
  }
  const stage = options.stage ?? stageOf(login)
  const config: RoomConfig = {
    version: 1,
    room: roomOf(options.projectId, stage),
    name: options.name,
    stage,
    project: {
      kind: "linear",
      id: options.projectId,
      name: options.projectName,
      ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    },
    repo: { owner: repo.owner, name: repo.name, root },
    ingress: { github: "forward", linear: "poll" },
    review: {
      trigger: "review_requested",
      provider: "opencode-go",
      model: "deepseek-v4.1-flash",
      slots: 1,
    },
    createdAt: new Date().toISOString(),
  }
  mkdirSync(join(root, ".room"), { recursive: true })
  writeFileSync(path, encodeConfig(config))
  recordRoom({
    room: config.room,
    name: config.name,
    projectId: config.project.id,
    stage: config.stage,
    configPath: path,
    lastSeen: Date.now(),
  })
  let configured = false
  try {
    // The room may not be running yet; that is a note in the output, not a failed init.
    await new RoomClient(roomUrl(), config.room).configure(actorOf(login), config.name)
    configured = true
  } catch {
    configured = false
  }
  return { config, path, configured }
}

export interface Check {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

export const doctor = async (cwd: string): Promise<ReadonlyArray<Check>> => {
  const checks: Array<Check> = []
  const root = topLevel(cwd) ?? cwd
  const config = readConfig(configPathOf(root))
  checks.push({
    name: "config",
    ok: config !== undefined,
    detail: config === undefined ? `${CONFIG_PATH} missing or unreadable` : config.room,
  })
  if (config === undefined) return checks
  const login = authLogin()
  checks.push({
    name: "github",
    ok: login !== undefined,
    detail: login ?? "gh is not authenticated",
  })
  checks.push({
    name: "actor",
    ok: login !== undefined && config.stage.endsWith(`/${login}`),
    detail: login === undefined ? "no login to compare" : `stage ${config.stage} vs token ${login}`,
  })
  checks.push({
    name: "celld",
    ok: onPath("celld") !== undefined,
    detail: onPath("celld") ?? "not installed: curl -fsSL https://celld.dev/install.sh | sh",
  })
  const webhook = run({ command: "gh", args: ["extension", "list"] })
  checks.push({
    name: "gh-webhook",
    ok: webhook.stdout.includes("webhook"),
    detail: webhook.stdout.includes("webhook")
      ? "installed"
      : "gh extension install cli/gh-webhook",
  })
  checks.push({
    name: "linear",
    ok: linearTokenPresent(),
    detail: linearTokenPresent() ? "token present" : "no ~/.linearis/token",
  })
  try {
    const health = await new RoomClient(roomUrl(), config.room).health()
    checks.push({
      name: "room",
      ok: true,
      detail: `${health.room} · ${JSON.stringify(health.counts)}`,
    })
  } catch {
    checks.push({
      name: "room",
      ok: false,
      detail: `not reachable at ${roomUrl()} — run \`jig room dev\``,
    })
  }
  return checks
}

export const renderChecks = (checks: ReadonlyArray<Check>): string =>
  checks
    .map((check) => `  ${check.ok ? "ok  " : "fail"}  ${check.name.padEnd(12)} ${check.detail}`)
    .join("\n")

export const webhookCommand = (config: RoomConfig): string =>
  [
    "gh webhook forward",
    `  --repo ${config.repo.owner}/${config.repo.name}`,
    "  --events pull_request,pull_request_review,pull_request_review_comment",
    `  --url ${roomUrl()}/r/${encodeURIComponent(config.room)}/ingest`,
  ].join(" \\\n")
