import { actorOf, roomOf, stageOf } from "@autotelic/board"
import { Effect, FileSystem, Option, Result, Schema } from "effect"
import { join } from "node:path"
import { RoomClient, type Board } from "./client.ts"
import { CONFIG_PATH, type RoomConfig, encodeConfig, readConfig } from "./config.ts"
import { roomUrl } from "./daemon.ts"
import { authLogin, linearTokenPresent } from "./gh.ts"
import { repoOf, topLevel } from "./git.ts"
import { configPathOf, readIndex, recordRoom, roomsByActivity } from "./paths.ts"
import { onPath, run } from "./shell.ts"

/*
 * The commands behind `jig room`.
 *
 * `plan` is read-only and ends with the exact `init` it would run; `init` applies it; `doctor`
 * proves the loop. That is the same shape as `jig onboard` / `jig init`, because the person
 * approving a plan should not have to re-derive it from flags.
 */

/** The value of a successful result, or nothing. */
const valueOf = <A>(result: Result.Result<A, string>): Option.Option<A> =>
  Result.isSuccess(result) ? Option.some(result.success) : Option.none()

/** What the room would be, before anything is written. */
export interface Plan {
  readonly root: string
  readonly repo: string | undefined
  readonly login: string | undefined
  readonly authenticated: boolean
  readonly linearToken: boolean
  readonly config: RoomConfig | undefined
  readonly rooms: ReadonlyArray<{ room: string; name: string; stage: string; lastSeen: number }>
}

/**
 * Read the facts a room would be created from.
 *
 * @param cwd - The directory the person ran the command in.
 * @returns The plan, with no writes.
 */
export const plan = (cwd: string): Effect.Effect<Plan, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const root = Option.getOrUndefined(valueOf(topLevel(cwd))) ?? cwd
    const repo = Option.getOrUndefined(valueOf(repoOf(root)))
    const login = Option.getOrUndefined(valueOf(authLogin()))
    const config = Result.getOrUndefined(yield* readConfig(configPathOf(root)))
    const index = yield* readIndex
    return {
      root,
      repo: repo === undefined ? undefined : `${repo.owner}/${repo.name}`,
      login,
      authenticated: login !== undefined,
      linearToken: linearTokenPresent(),
      config,
      rooms: index.rooms.map(({ room, name, stage, lastSeen }) => ({
        room,
        name,
        stage,
        lastSeen,
      })),
    }
  })

const ago = ({ at, now }: { readonly at: number; readonly now: number }): string => {
  if (at === 0) return "never"
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Render the plan as the text a person reads.
 *
 * @param value - The plan.
 * @returns The report.
 */
export const renderPlan = (value: Plan, now: number): string => {
  const lines: Array<string> = ["room · plan", ""]
  lines.push(`  repo      ${value.repo ?? "(no origin remote)"}`)
  lines.push(`  root      ${value.root}`)
  lines.push(`  github    ${value.login ?? "(gh not authenticated)"}`)
  lines.push(`  linear    ${value.linearToken ? "token present" : "no token at ~/.linearis/token"}`)
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
      lines.push(
        `    ${room.name.padEnd(22)} ${room.stage.padEnd(18)} ${ago({ at: room.lastSeen, now })}`,
      )
    }
  }
  lines.push("")
  lines.push("  questions")
  lines.push("    1. room name?          e.g. multi-season")
  lines.push("    2. linear project?     the id from `linearis projects list`")
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

/** What an init needs. */
export interface InitOptions {
  readonly cwd: string
  readonly name: string
  readonly projectId: string
  readonly projectName: string
  readonly workspace: string | undefined
  readonly stage: string | undefined
  readonly force: boolean
  readonly now: number
}

/** What an init produced. */
export interface InitResult {
  readonly config: RoomConfig
  readonly path: string
  readonly configured: boolean
}

/**
 * Write the config, register the room, and tell the room who it acts as.
 *
 * @param options - The room's name, project, stage, and the instant to record.
 * @returns The config and the paths, or a message in the error channel.
 */
export const init = (
  options: InitOptions,
): Effect.Effect<InitResult, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const root = Option.getOrUndefined(valueOf(topLevel(options.cwd))) ?? options.cwd
    const login = Option.getOrUndefined(valueOf(authLogin()))
    if (login === undefined)
      return yield* Effect.fail("gh is not authenticated; run `gh auth login`")
    const repo = Option.getOrUndefined(valueOf(repoOf(root)))
    if (repo === undefined) return yield* Effect.fail("no GitHub origin remote")
    const path = configPathOf(root)
    const exists = yield* Effect.orElseSucceed(fs.exists(path), () => false)
    if (exists && !options.force) {
      return yield* Effect.fail(`${CONFIG_PATH} already exists; pass --force to rewrite it`)
    }
    const stage = options.stage ?? stageOf(login)
    const config: RoomConfig = {
      version: 1,
      room: roomOf({ projectId: options.projectId, stage }),
      name: options.name,
      stage,
      project: Object.assign(
        { kind: "linear" as const, id: options.projectId, name: options.projectName },
        options.workspace === undefined ? {} : { workspace: options.workspace },
      ),
      repo: { owner: repo.owner, name: repo.name, root },
      ingress: { github: "forward", linear: "poll" },
      review: {
        trigger: "review_requested",
        provider: "opencode-go",
        model: "deepseek-v4.1-flash",
        slots: 1,
      },
      createdAt: new Date(options.now).toISOString(),
    }
    yield* Effect.orElseSucceed(
      fs.makeDirectory(join(root, ".room"), { recursive: true }),
      () => undefined,
    )
    yield* fs.writeFileString(path, encodeConfig(config))
    yield* recordRoom({
      room: config.room,
      name: config.name,
      projectId: config.project.id,
      stage: config.stage,
      configPath: path,
      lastSeen: options.now,
    })
    const configured = yield* Effect.tryPromise({
      try: () => new RoomClient(roomUrl(), config.room).configure(actorOf(login), config.name),
      catch: () => "room not reachable",
    }).pipe(
      Effect.map(() => true),
      Effect.orElseSucceed(() => false),
    )
    return { config, path, configured }
  }).pipe(Effect.mapError((error) => String(error)))

/** One doctor line. */
export const Check = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String,
})

/** One doctor line. */
export type Check = typeof Check.Type

/**
 * Prove the loop: config, identity, celld, the forward, and the room.
 *
 * @param cwd - The directory the person ran the command in.
 * @returns The checks, in the order a person reads them.
 */
export const doctor = (
  cwd: string,
): Effect.Effect<ReadonlyArray<Check>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const root = Option.getOrUndefined(valueOf(topLevel(cwd))) ?? cwd
    const config = Result.getOrUndefined(yield* readConfig(configPathOf(root)))
    const checks: Array<Check> = []
    checks.push({
      name: "config",
      ok: config !== undefined,
      detail: config === undefined ? `${CONFIG_PATH} missing or unreadable` : config.room,
    })
    if (config === undefined) return checks
    const login = Option.getOrUndefined(valueOf(authLogin()))
    checks.push({
      name: "github",
      ok: login !== undefined,
      detail: login ?? "gh is not authenticated",
    })
    checks.push({
      name: "actor",
      ok: login !== undefined && config.stage.endsWith(`/${login}`),
      detail:
        login === undefined ? "no login to compare" : `stage ${config.stage} vs token ${login}`,
    })
    const celld = Option.getOrUndefined(valueOf(onPath("celld")))
    checks.push({
      name: "celld",
      ok: celld !== undefined,
      detail: celld ?? "not installed: curl -fsSL https://celld.dev/install.sh | sh",
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
    const health = yield* Effect.tryPromise({
      try: () => new RoomClient(roomUrl(), config.room).health(),
      catch: () => "unreachable",
    }).pipe(Effect.option)
    checks.push({
      name: "room",
      ok: Option.isSome(health),
      detail: Option.isSome(health)
        ? `${health.value.room} · ${JSON.stringify(health.value.counts)}`
        : `not reachable at ${roomUrl()} — run \`jig room dev\``,
    })
    return checks
  })

/**
 * Render the doctor checks.
 *
 * @param checks - The checks to render.
 * @returns One line per check.
 */
export const renderChecks = (checks: ReadonlyArray<Check>): string =>
  checks
    .map((check) => `  ${check.ok ? "ok  " : "fail"}  ${check.name.padEnd(12)} ${check.detail}`)
    .join("\n")

/**
 * The `gh webhook forward` command for a room.
 *
 * @param config - The room's config.
 * @returns A shell-ready command.
 */
export const webhookCommand = (config: RoomConfig): string =>
  [
    "gh webhook forward",
    `  --repo ${config.repo.owner}/${config.repo.name}`,
    "  --events pull_request,pull_request_review,pull_request_review_comment",
    `  --url ${roomUrl()}/r/${encodeURIComponent(config.room)}/ingest`,
  ].join(" \\\n")

/**
 * Render the board as the lines a terminal shows.
 *
 * @param input - The room's config and its board, when the room answered.
 * @returns The compact board.
 */
export const renderBoard = (input: {
  readonly config: RoomConfig
  readonly board: Board | undefined
}): string => {
  const { config, board } = input
  const lines = [`room ${config.name} · ${config.stage}`]
  if (board === undefined) {
    lines.push(`  roomd   not reachable at ${roomUrl()} — run \`jig room dev\``)
    return lines.join("\n")
  }
  const byState = (state: string): number => board.jobs.filter((job) => job.state === state).length
  lines.push(`  roomd   reachable · ${board.presence.length} present`)
  lines.push(
    `  jobs    running ${byState("running")} · queued ${byState("queued")} · failed ${byState("failed")}`,
  )
  lines.push(
    `  chits   ${board.chits.map((entry) => `${entry.state} ${entry.count}`).join(" · ") || "none"}`,
  )
  lines.push(`  here    ${board.presence.map((presence) => presence.host).join(" · ") || "nobody"}`)
  return lines.join("\n")
}

/** Re-exported for the picker. */
export { roomsByActivity }
