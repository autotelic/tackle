import { jobOf, labelRoomOf, roomOf, stageOf, type Job } from "@autotelic/board"
import { Clock, Effect, FileSystem, Option, Result, Schema } from "effect"
import { homedir } from "node:os"
import { join } from "node:path"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { RoomClient, type Board } from "./client.ts"
import { CONFIG_PATH, type RoomConfig, encodeConfig, readConfig } from "./config.ts"
import { roomUrl } from "./daemon.ts"
import { seedRoom } from "./seed.ts"
import { authLogin, linearTokenPresent } from "./gh.ts"
import { addWorktree, fetchCommit, fetchPull, removeWorktree, repoOf, topLevel } from "./git.ts"
import {
  configPathOf,
  findConfigPath,
  legacyConfigPathOf,
  readIndex,
  recordRoom,
  roomsByActivity,
} from "./paths.ts"
import { onPath, run } from "./shell.ts"
import { pullRequest } from "./gh.ts"
import { renderDriver, type Driver } from "./driver.ts"
import { runReview } from "./review.ts"
import { jobsRoot, worktreeRoot } from "./paths.ts"

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
    const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
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
    // The room this directory is bound to, then what it is for. The address
    // (`linear:<uuid>@<stage>`) is how the code names a room, not how a person does.
    lines.push(
      `  existing  ${value.config.name} (${value.config.project.name}, ${value.config.stage})`,
    )
  } else {
    lines.push("  existing  no room.config.json in this repo")
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
  lines.push("    2. address?            a Linear project id (`linearis projects list`),")
  lines.push("                           or a GitHub label for a workstream with no project")
  lines.push(
    `    3. stage?              ${value.login === undefined ? "local/<login>" : stageOf(value.login)}`,
  )
  const stage = value.login === undefined ? "" : ` --stage ${stageOf(value.login)}`
  lines.push("")
  lines.push("  next")
  lines.push(`    jig room init --room <name> --linear-project <id> --linear-name "<name>"${stage}`)
  lines.push("    or, when the workstream is a label and has no Linear project:")
  lines.push(`    jig room init --room <name> --label <github-label>${stage}`)
  return lines.join("\n")
}

/** What an init needs. */
export interface InitOptions {
  readonly cwd: string
  readonly name: string
  /**
   * A Linear project is one kind of address, and it needs both flags; a GitHub label is the
   * other kind. Which one a config carries is decided by {@link addressRefusal}, not here.
   */
  readonly projectId: string | undefined
  readonly projectName: string | undefined
  readonly workspace: string | undefined
  readonly stage: string | undefined
  /** The GitHub label: the address of a label-only room, and the watch label of any room. */
  readonly label: string | undefined
  readonly linearUser: string | undefined
  readonly force: boolean
  readonly now: number
}

/** What a room is addressed by, before it is known whether that address is complete. */
export interface Address {
  readonly projectId: string | undefined
  readonly projectName: string | undefined
  readonly label: string | undefined
}

/**
 * Fill absent address flags from the config a rewrite is replacing.
 *
 * `--force` without an address keeps the room it rebinds: the flags that created the config are
 * the ones a re-run is most likely to omit, and dropping them would turn a Linear room into a
 * refusal for no reason a person asked for.
 *
 * @param input - The flags and the config being rewritten, when there is one.
 * @returns The address, with the previous one where a flag was silent.
 */
export const resolveAddress = (
  input: Address & { readonly previous: RoomConfig | undefined },
): Address => {
  const previous = input.previous
  const linear = previous?.project.kind === "linear" ? previous.project : undefined
  const label = previous?.project.kind === "github" ? previous.project.id : undefined
  return {
    projectId: input.projectId ?? linear?.id,
    projectName: input.projectName ?? linear?.name,
    label: input.label ?? label ?? previous?.watch?.label,
  }
}

/**
 * Why a room cannot be created from this address, or undefined when it can.
 *
 * The one thing a room cannot be without is an address: the project or the label is what names
 * the workstream, and a room that has neither is a ledger nothing routes to. `--label` is the
 * address of a label-addressed room and the watched label of a project one, which is why the two
 * are not exclusive.
 *
 * @param input - The address flags, after {@link resolveAddress}.
 * @returns The refusal, as the sentence a person reads, or nothing when it may proceed.
 *
 * Not `Option`: plumb's rules want a tagged failure (`Effect`/`Either`) when the two refusals
 * differ in *why*, and they do. Converting this one helper alone would leave `initRefusal`
 * beside it in the older idiom, so the whole refusal family moves together or not at all.
 */
export const addressRefusal = (input: Address): string | undefined => {
  const project = input.projectId !== undefined || input.projectName !== undefined
  if (project && (input.projectId === undefined || input.projectName === undefined)) {
    return (
      "--linear-project and --linear-name go together: the id addresses the room, " +
      "the name is what a person reads"
    )
  }
  if (project) return undefined
  if (input.label !== undefined) return undefined
  return (
    "a room needs an address: --linear-project <id> --linear-name <name>, " +
    "or --label <github-label> for a workstream with no Linear project"
  )
}

/** What an init produced. */
export interface InitResult {
  readonly config: RoomConfig
  readonly path: string
  readonly configured: boolean
  /** Fields no flag speaks for, carried over from the config this run rewrote. */
  readonly kept: ReadonlyArray<string>
}

/**
 * Why `init` refuses to write, absent when it may.
 *
 * A checkout holds one room, and every session in that directory reads it. Naming the room the
 * checkout is already bound to is the difference between a safety check and an unexplained
 * "already exists": the person needs to know that `--force` rebinds the *directory*, not just
 * this command's config file.
 */
export const initRefusal = (input: {
  readonly exists: boolean
  readonly force: boolean
  readonly previous: RoomConfig | undefined
}): string | undefined => {
  if (!input.exists || input.force) return undefined
  if (input.previous === undefined) {
    return `${CONFIG_PATH} already exists and does not decode; pass --force to rewrite it`
  }
  return (
    `${CONFIG_PATH} already exists: this checkout is bound to ${input.previous.name} ` +
    `(${input.previous.project.name}, ${input.previous.stage}). Every session in this directory ` +
    `uses that room. Pass --force to rebind it.`
  )
}

/**
 * The config an init writes: flags win, and the file being rewritten supplies the rest.
 *
 * Rebinding is not a reset. A review model, a worker block, an ingress policy and the watch
 * label are decisions written into the file, and no flag expresses them -- so rebuilding them
 * from defaults silently changed how the room behaved. A `--force` re-run used to drop
 * `watch.label` exactly this way and left the label column empty.
 */
export const initRoomConfig = (input: {
  readonly options: Pick<
    InitOptions,
    "name" | "projectId" | "projectName" | "workspace" | "label" | "linearUser" | "now"
  >
  readonly stage: string
  readonly repo: { readonly owner: string; readonly name: string }
  readonly root: string
  readonly previous: RoomConfig | undefined
}): RoomConfig => {
  const previous = input.previous
  const address = resolveAddress({ ...input.options, previous })
  const watch = input.options.label === undefined ? previous?.watch : { label: input.options.label }
  const linearUser = input.options.linearUser ?? previous?.linearUser
  const workspace =
    input.options.workspace ??
    (previous?.project.kind === "linear" ? previous.project.workspace : undefined)
  // addressRefusal refuses the incomplete cases before a config is built. The empty label here
  // keeps the type honest instead of asserting that one of the two address flags arrived.
  const label = address.label ?? ""
  const project: RoomConfig["project"] =
    address.projectId !== undefined && address.projectName !== undefined
      ? Object.assign(
          { kind: "linear" as const, id: address.projectId, name: address.projectName },
          workspace === undefined ? {} : { workspace },
        )
      : { kind: "github" as const, id: label, name: label }
  // A rewrite that changes the address's kind is not a rewrite: the ingress was chosen for the
  // old one (a Linear poll for what is now a label), so it goes back to that kind's default.
  const ingress =
    previous !== undefined && previous.project.kind === project.kind
      ? previous.ingress
      : {
          github: "forward" as const,
          linear: project.kind === "linear" ? ("poll" as const) : ("none" as const),
        }
  return Object.assign(
    {
      version: 1 as const,
      room:
        project.kind === "linear"
          ? roomOf({ projectId: project.id, stage: input.stage })
          : labelRoomOf({ label: project.id, stage: input.stage }),
      name: input.options.name,
      stage: input.stage,
      project,
      repo: { owner: input.repo.owner, name: input.repo.name, root: input.root },
      ingress,
      review: previous?.review ?? {
        trigger: "review_requested" as const,
        provider: "opencode-go",
        model: "deepseek-v4.1-flash",
        slots: 1,
      },
      worker: previous?.worker ?? { substrate: "hc" as const },
      createdAt: new Date(input.options.now).toISOString(),
    },
    watch === undefined ? {} : { watch },
    linearUser === undefined ? {} : { linearUser },
    previous?.batchMs === undefined ? {} : { batchMs: previous.batchMs },
  )
}

/** What a re-run carried over, named so the person can see the file did not lose it. */
export const keptFields = (
  previous: RoomConfig | undefined,
  options: Pick<InitOptions, "label" | "linearUser" | "workspace">,
): ReadonlyArray<string> => {
  if (previous === undefined) return []
  const kept = ["review", "ingress"]
  if (previous.worker !== undefined) kept.push("worker")
  if (previous.watch !== undefined && options.label === undefined) kept.push("watch.label")
  if (previous.batchMs !== undefined) kept.push("batchMs")
  if (previous.linearUser !== undefined && options.linearUser === undefined) kept.push("linearUser")
  if (
    previous.project.kind === "linear" &&
    previous.project.workspace !== undefined &&
    options.workspace === undefined
  ) {
    kept.push("workspace")
  }
  return kept
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
    const existing = findConfigPath(root)
    const exists = yield* Effect.orElseSucceed(fs.exists(existing), () => false)
    const previous = exists ? Result.getOrUndefined(yield* readConfig(existing)) : undefined
    const refusal = initRefusal({ exists, force: options.force, previous })
    if (refusal !== undefined) return yield* Effect.fail(refusal)
    const address = resolveAddress({
      projectId: options.projectId,
      projectName: options.projectName,
      label: options.label,
      previous,
    })
    const unaddressed = addressRefusal(address)
    if (unaddressed !== undefined) return yield* Effect.fail(unaddressed)
    const stage = options.stage ?? stageOf(login)
    const config = initRoomConfig({
      options: { ...options, ...address },
      stage,
      repo,
      root,
      previous,
    })
    const kept = keptFields(previous, options)
    yield* Effect.orElseSucceed(
      fs.makeDirectory(join(root, ".room"), { recursive: true }),
      () => undefined,
    )
    yield* fs.writeFileString(path, encodeConfig(config))
    if (existing !== path) {
      yield* Effect.orElseSucceed(fs.remove(existing), () => undefined)
    }
    const legacy = legacyConfigPathOf(root)
    if (legacy !== existing) {
      yield* Effect.orElseSucceed(fs.remove(legacy), () => undefined)
    }
    const legacyDir = join(root, ".room")
    const leftovers = yield* Effect.orElseSucceed(fs.readDirectory(legacyDir), () => [])
    if (leftovers.length === 0) {
      yield* Effect.orElseSucceed(fs.remove(legacyDir, { recursive: true }), () => undefined)
    }
    yield* recordRoom({
      room: config.room,
      name: config.name,
      projectId: config.project.id,
      stage: config.stage,
      configPath: path,
      lastSeen: options.now,
    })
    // Seed from the file, not from today's flags: the committed config is what a second
    // machine inherits, and a re-run without `--label` must not silently drop it.
    const configured = yield* Effect.tryPromise({
      try: () => seedRoom({ config, url: roomUrl() }),
      catch: () => Result.fail("room not reachable"),
    }).pipe(
      Effect.map(() => true),
      Effect.orElseSucceed(() => false),
    )
    return { config, path, configured, kept }
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
 * Prove the loop: config, identity, celld, `pi`, the forward, and the room.
 *
 * @param cwd - The directory the person ran the command in.
 * @param options - An alternate PATH lookup, so a test can describe a machine it is not on.
 * @returns The checks, in the order a person reads them.
 */
export const doctor = (
  cwd: string,
  options: { readonly look?: (name: string) => string | undefined } = {},
): Effect.Effect<ReadonlyArray<Check>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const look = options.look ?? ((name: string) => Option.getOrUndefined(valueOf(onPath(name))))
    const root = Option.getOrUndefined(valueOf(topLevel(cwd))) ?? cwd
    const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
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
    const celld = look("celld")
    checks.push({
      name: "celld",
      ok: celld !== undefined,
      detail: celld ?? "not installed: curl -fsSL https://celld.dev/install.sh | sh",
    })
    // Both halves of the loop run `pi`: the review spawns it, and the wake resumes the
    // project session with it. A missing `pi` is silent otherwise -- the room looks healthy
    // until the first event nobody answers.
    const pi = look("pi")
    checks.push({
      name: "pi",
      ok: pi !== undefined,
      detail: pi ?? "not on PATH: the review and the session wake both run it",
    })
    const webhook = run({ command: "gh", args: ["extension", "list"] })
    checks.push({
      name: "gh-webhook",
      ok: webhook.stdout.includes("webhook"),
      detail: webhook.stdout.includes("webhook")
        ? "installed"
        : "gh extension install cli/gh-webhook",
    })
    // A label-addressed room has no project to read, so a missing Linear token is not a fault
    // there: reporting it as one would send a person to log in to a service they do not use.
    const wantsLinear = config.project.kind === "linear"
    checks.push({
      name: "linear",
      ok: !wantsLinear || linearTokenPresent(),
      detail: !wantsLinear
        ? "not used: this room is addressed by a GitHub label"
        : linearTokenPresent()
          ? "token present"
          : "no ~/.linearis/token",
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
 * Render the board as the lines a terminal shows.
 *
 * @param input - The room's config and its board, when the room answered.
 * @returns The compact board.
 */
export const renderBoard = (input: {
  readonly config: RoomConfig
  readonly board: Board | undefined
  /** The instant the board was read: taken at the boundary so rendering stays pure. */
  readonly now: number
  /**
   * The session that claimed the room's conversation, read from this machine's state. It is not
   * part of the daemon's board: the claim is local, and it has to be readable even when roomd is
   * down, which is exactly when a second session is deciding whether to start.
   */
  readonly driver?: Driver | undefined
}): string => {
  const { config, board } = input
  const lines = [`room ${config.name} · ${config.stage}`]
  lines.push(`  ${renderDriver({ driver: input.driver, now: input.now })}`)
  if (board === undefined) {
    lines.push(`  roomd   not reachable at ${roomUrl()} — run \`jig room dev\``)
    return lines.join("\n")
  }
  const byState = (state: string): number => board.jobs.filter((job) => job.state === state).length
  lines.push(`  roomd   reachable · ${board.presence.length} present`)
  lines.push(
    `  jobs    running ${byState("running")} · claimed ${byState("claimed")} · queued ${byState("queued")} · failed ${byState("failed")}`,
  )
  lines.push(
    `  chits   ${board.chits.map((entry) => `${entry.state} ${entry.count}`).join(" · ") || "none"}`,
  )
  // A label filter that drops in silence is indistinguishable from an ingress that never
  // arrived, so the count is on the board rather than only in the ledger.
  const unrouted = board.unrouted ?? 0
  if (unrouted > 0) {
    lines.push(
      `  unrouted ${String(unrouted)} review event(s) were not this room's label` +
        (config.watch?.label === undefined ? "" : ` (${config.watch.label})`),
    )
  }
  const checks = board.checks ?? []
  if (checks.length > 0) {
    const mark = (conclusion: string): string =>
      conclusion === "success"
        ? "ok"
        : conclusion === "skipped"
          ? "--"
          : conclusion === "cancelled" || conclusion === "timed_out"
            ? conclusion
            : "failed"
    lines.push(
      "  ci      " +
        checks
          .map((check) => {
            const head =
              "#" + String(check.pr) + " " + check.workflow + " " + mark(check.conclusion)
            // Only a rerun earns the qualifier: a permanent "attempt 1" is clutter people stop
            // reading, and a rerun that hides what it replaced is the failure this guards.
            const attempt = check.attempt ?? 1
            const previous = check.previous ?? null
            if (attempt <= 1 || previous === null) return head
            return (
              head +
              " (rerun " +
              String(attempt) +
              "; attempt " +
              String(previous.attempt) +
              " " +
              mark(previous.conclusion) +
              ")"
            )
          })
          .join(" · "),
    )
  }
  const inbox = board.inbox
  lines.push(
    `  inbox   ${
      inbox === undefined || inbox.pending === 0
        ? "none waiting"
        : `${String(inbox.turns)} turn(s) · ${String(inbox.cards)} card(s) waiting${
            inbox.held === 0 ? "" : ` · ${String(inbox.held)} held by the batch`
          }`
    }`,
  )
  lines.push(`  here    ${board.presence.map((presence) => presence.host).join(" · ") || "nobody"}`)
  lines.push(
    `  work    ${
      board.workers
        .map(
          (worker) =>
            `${worker.name} ${worker.address}${worker.url === undefined ? "" : ` · ${worker.url}`}`,
        )
        .join(" · ") || "none"
    }`,
  )
  return lines.join("\n")
}

/** The substrate that hosts a worker's terminal. */
export type Substrate = "hc" | "rex"

/** Start a worker's Pi under herdr-core and return its address. */
const launchHc = (input: {
  readonly hc: string
  readonly name: string
  readonly dir: string
  readonly script: string
}): Result.Result<string, string> => {
  run({ command: input.hc, args: ["kill", input.name] })
  run({ command: input.hc, args: ["rm", input.name] })
  const launched = run({
    command: input.hc,
    args: ["run", "--bg", "--json", "--name", input.name, "--cwd", input.dir, "sh", input.script],
  })
  const decoded = Schema.decodeResult(
    Schema.fromJsonString(Schema.Struct({ address: Schema.String })),
  )(launched.stdout)
  return Result.isFailure(decoded)
    ? Result.fail(launched.stderr.trim() || launched.failure || "hc did not return an address")
    : Result.succeed(decoded.success.address)
}

/**
 * Start a worker's Pi as a Rex session and return the session id.
 *
 * One session per worker, not a tab in somebody else's: `rex new <label>` is the whole launch,
 * and the app can show it when a person wants to watch. `--json` hands back the id, which the
 * room records as the worker's address — the same field hc fills with a terminal address.
 */
const launchRex = (input: {
  readonly name: string
  readonly dir: string
  readonly script: string
  /** The session to add a tab to. Absent: a session of its own, addressed by session id. */
  readonly session?: string | undefined
}): Result.Result<string, string> => {
  const rex = Result.getOrUndefined(onPath("rex"))
  if (rex === undefined) return Result.fail("rex is not on PATH")
  if (input.session !== undefined && input.session !== "") {
    // A tab in the session a person is already watching, not a new window: the review shows up
    // where the work is, and `--focus=false` keeps the launch from stealing the pane in use.
    const created = run({
      command: rex,
      args: [
        "window",
        "new",
        "-s",
        input.session,
        input.name,
        "--focus=false",
        "-c",
        input.dir,
        "--json",
        "--",
        "sh",
        input.script,
      ],
    })
    const decoded = Schema.decodeResult(
      Schema.fromJsonString(Schema.Struct({ window_id: Schema.String })),
    )(created.stdout)
    return Result.isFailure(decoded)
      ? Result.fail(created.stderr.trim() || created.failure || "rex did not return a window")
      : Result.succeed(decoded.success.window_id)
  }
  const created = run({
    command: rex,
    args: ["new", input.name, "-c", input.dir, "--json", "--", "sh", input.script],
  })
  const decoded = Schema.decodeResult(
    Schema.fromJsonString(Schema.Struct({ session_id: Schema.String })),
  )(created.stdout)
  return Result.isFailure(decoded)
    ? Result.fail(created.stderr.trim() || created.failure || "rex did not return a session")
    : Result.succeed(decoded.success.session_id)
}

/** The herdr-core binary, if this machine has it. */
const hcOf = (): Option.Option<string> => {
  const global = valueOf(onPath("hc"))
  if (Option.isSome(global)) return global
  const local = join(homedir(), ".local", "bin", "hc")
  return existsSync(local) ? Option.some(local) : Option.none()
}

/** A port nobody is using right now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", () => reject("no free port"))
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const parsed = Schema.decodeUnknownResult(Schema.Struct({ port: Schema.Finite }))(address)
      if (Result.isFailure(parsed)) {
        server.close()
        reject("no free port")
        return
      }
      const port = parsed.success.port
      server.close(() => resolve(port))
    })
  })

const expand = (
  value: string,
  vars: { readonly port: string; readonly worker: string; readonly worktree: string },
): string =>
  value
    .replaceAll("${PORT}", vars.port)
    .replaceAll("${WORKER}", vars.worker)
    .replaceAll("${WORKTREE}", vars.worktree)

const shellFile = (input: {
  readonly dir: string
  readonly name: string
  readonly lines: ReadonlyArray<string>
}): string => {
  mkdirSync(input.dir, { recursive: true })
  const file = join(input.dir, `${input.name}.sh`)
  writeFileSync(file, ["#!/bin/sh", ...input.lines, ""].join("\n"))
  chmodSync(file, 0o755)
  return file
}

/**
 * Start an attachable worker session in its own worktree, with its own port, environment,
 * and (when configured) database and app.
 *
 * @param input - The repository, the PR, and the kind of work.
 * @returns The worker name, its attach address, and the app URL when one was started.
 */
export const startWorker = (input: {
  readonly cwd: string
  readonly pr: number
  readonly kind: "fix" | "review"
  /** Overrides `worker.substrate` for this launch (`jig room work --substrate`). */
  readonly substrate?: Substrate | undefined
  /** The Rex session to open as a tab (`--rex-session`), when the substrate is rex. */
  readonly rexSession?: string | undefined
}): Effect.Effect<
  {
    readonly name: string
    readonly address: string
    readonly worktree: string
    readonly url?: string
  },
  string,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const root = Option.getOrUndefined(valueOf(topLevel(input.cwd))) ?? input.cwd
    const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
    if (config === undefined) return yield* Effect.fail("no room.config.json in this repository")
    const substrate: Substrate = input.substrate ?? config.worker?.substrate ?? "hc"
    const hc = substrate === "hc" ? Option.getOrUndefined(hcOf()) : undefined
    if (substrate === "hc" && hc === undefined) {
      return yield* Effect.fail("herdr-core is not installed (hc)")
    }
    if (substrate === "rex" && Result.isFailure(onPath("rex"))) {
      return yield* Effect.fail("rex is not on PATH")
    }
    if (substrate === "rex" && config.worker?.app !== undefined) {
      return yield* Effect.fail(
        "the app block is only implemented under hc; a rex worker starts the review session",
      )
    }
    // A review worker starts from the same handoff `--prepare` produces: the worktree is at the
    // reviewed sha and the prompt is written, so the session's first turn is `cd`, not
    // "resolve the PR, find the sha, reconstruct the contract".
    let dir = ""
    let prNumber = input.pr
    let promptFile: string | undefined
    if (input.kind === "review") {
      const now = yield* Clock.currentTimeMillis
      const prepared = yield* Effect.tryPromise({
        try: () =>
          runReview({
            config,
            job: {
              id: jobOf({ pr: input.pr, sha: "manual" }),
              room: config.room,
              kind: "review",
              pr: input.pr,
              sha: "manual",
              state: "queued",
              attempts: 0,
              createdAt: now,
              updatedAt: now,
            } satisfies Job,
            dryRun: false,
            prepare: true,
            log: () => undefined,
          }),
        catch: (error) => String(error),
      })
      const handoff = prepared.handoff
      if (handoff === undefined) return yield* Effect.fail(prepared.note)
      dir = handoff.worktree
      prNumber = handoff.pr
      promptFile = handoff.promptFile
    } else {
      const pr = Result.getOrUndefined(pullRequest({ number: input.pr, cwd: config.repo.root }))
      if (pr === undefined) return yield* Effect.fail(`cannot read PR #${input.pr}`)
      prNumber = pr.number
      dir = join(worktreeRoot(config), `pr-${pr.number}-${input.kind}-${pr.headRefOid.slice(0, 8)}`)
      mkdirSync(worktreeRoot(config), { recursive: true })
      if (existsSync(dir)) removeWorktree({ root: config.repo.root, dir })
      fetchPull({ root: config.repo.root, pr: pr.number })
      fetchCommit({ root: config.repo.root, sha: pr.headRefOid })
      const added = addWorktree({ root: config.repo.root, sha: pr.headRefOid, dir })
      if (Result.isFailure(added)) return yield* Effect.fail(added.failure)
    }

    const name = `room-${prNumber}-${input.kind}`
    const app = config.worker?.app
    const port =
      app === undefined
        ? undefined
        : yield* Effect.tryPromise({
            try: () => freePort(),
            catch: (error) => String(error),
          })
    const vars = { port: String(port ?? 0), worker: name, worktree: dir }
    const sessionDir = join(jobsRoot(config), name)
    mkdirSync(sessionDir, { recursive: true })
    const envFile = join(sessionDir, "env.sh")
    const env = Object.assign({}, app?.env ?? {}, {
      PORT: vars.port,
      ROOM_WORKER: name,
      WORKTREE: dir,
    })
    writeFileSync(
      envFile,
      `${Object.entries(env)
        .map(([key, value]) => `export ${key}='${expand(value, vars).replaceAll("'", "'\\''")}'`)
        .join("\n")}\n`,
    )
    if (app?.database !== undefined) {
      const created = run({
        command: "sh",
        args: ["-c", `. "${envFile}"; ${expand(app.database.create, vars)}`],
        cwd: dir,
      })
      if (created.code !== 0) {
        return yield* Effect.fail(created.stderr.trim() || "database create failed")
      }
    }

    let appAddress: string | undefined
    let url: string | undefined
    // The app block is hc-only: a substrate that hosts one terminal has nowhere to put it,
    // and `startWorker` already refused a rex worker with an app configured.
    if (app !== undefined && hc !== undefined) {
      const appScript = shellFile({
        dir: sessionDir,
        name: "app",
        lines: [
          `. "${envFile}"`,
          `cd "${dir}"`,
          ...(app.setup === undefined ? [] : [expand(app.setup, vars)]),
          `exec ${expand(app.up, vars)}`,
        ],
      })
      const appName = `${name}-app`
      run({ command: hc, args: ["kill", appName] })
      run({ command: hc, args: ["rm", appName] })
      const launched = run({
        command: hc,
        args: ["run", "--bg", "--json", "--name", appName, "--cwd", dir, "sh", appScript],
      })
      const decoded = Schema.decodeResult(
        Schema.fromJsonString(Schema.Struct({ address: Schema.String })),
      )(launched.stdout)
      if (Result.isFailure(decoded)) {
        return yield* Effect.fail(launched.stderr.trim() || "app failed to start")
      }
      appAddress = decoded.success.address
      url = app.health === undefined ? `http://127.0.0.1:${port}` : expand(app.health, vars)
    }

    const piScript = shellFile({
      dir: sessionDir,
      name: "pi",
      lines: [
        `. "${envFile}"`,
        `cd "${dir}"`,
        // A prepared review starts with its prompt, so "kick off a review" means the review
        // begins; a fix worker starts bare and waits for a person.
        promptFile === undefined ? "exec pi" : `exec pi "$(cat '${promptFile}')"`,
      ],
    })
    // The tab's home: the flag wins, then the room's committed choice, then the session this
    // command runs inside (a person who launched it from a Rex pane is already in one).
    const rexSession = input.rexSession ?? config.worker?.rex?.session ?? process.env.REX_SESSION
    const launchedPi =
      substrate === "rex"
        ? launchRex({ name, dir, script: piScript, session: rexSession })
        : launchHc({ hc: hc ?? "", name, dir, script: piScript })
    if (Result.isFailure(launchedPi)) return yield* Effect.fail(launchedPi.failure)
    const address = launchedPi.success
    yield* Effect.tryPromise({
      try: () =>
        new RoomClient(roomUrl(), config.room).putWorker(
          Object.assign(
            { name, pr: prNumber, kind: input.kind, address, worktree: dir },
            port === undefined ? {} : { port },
            url === undefined ? {} : { url },
            appAddress === undefined ? {} : { appAddress },
          ),
        ),
      catch: () => "room not reachable",
    }).pipe(Effect.orElseSucceed(() => ({ ok: false })))
    return Object.assign({ name, address, worktree: dir }, url === undefined ? {} : { url })
  })

/**
 * The open PRs that ask this person to review, as GitHub reports them.
 *
 * The search is GitHub's, not a filter of ours: `review-requested:@me` is the same question the
 * command line answers, and it drops a PR once a review is submitted.
 *
 * @param config - The room, for the repository and the directory to run `gh` in.
 * @returns The PR numbers, empty when `gh` could not answer.
 */
export const reviewRequests = (config: RoomConfig): ReadonlyArray<number> => {
  const repo = `${config.repo.owner}/${config.repo.name}`
  const listed = run({
    command: "gh",
    args: [
      "pr",
      "list",
      "-R",
      repo,
      "--search",
      "review-requested:@me",
      "--state",
      "open",
      "--json",
      "number",
      "--limit",
      "20",
    ],
    cwd: config.repo.root,
  })
  const decoded = Schema.decodeResult(
    Schema.fromJsonString(Schema.Array(Schema.Struct({ number: Schema.Finite }))),
  )(listed.stdout)
  return Result.isSuccess(decoded) ? decoded.success.map((entry) => entry.number) : []
}

/** The worker list the room returns, narrowed to what attach needs. */
interface WorkerList {
  readonly workers: ReadonlyArray<{
    readonly name: string
    readonly address: string
    readonly worktree: string
    readonly appAddress?: string
  }>
}

/**
 * Stop a worker: its app, its database, its terminals, and its worktree.
 *
 * @param input - The repository and the worker name.
 * @returns The stopped worker's name, or why it could not stop.
 */
export const stopWorker = (input: {
  readonly cwd: string
  readonly name: string
}): Effect.Effect<string, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const hc = Option.getOrUndefined(hcOf())
    const root = Option.getOrUndefined(valueOf(topLevel(input.cwd))) ?? input.cwd
    const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
    if (config === undefined) return yield* Effect.fail("no room.config.json in this repository")
    const workers = yield* Effect.tryPromise({
      try: () => new RoomClient(roomUrl(), config.room).workers(),
      catch: () => "room not reachable",
    }).pipe(Effect.orElseSucceed((): WorkerList => ({ workers: [] })))
    const worker = workers.workers.find((entry) => entry.name === input.name)
    if (worker === undefined) return yield* Effect.fail(`no worker named ${input.name}`)
    const app = config.worker?.app
    const envFile = join(jobsRoot(config), input.name, "env.sh")
    if (app?.down !== undefined && existsSync(envFile)) {
      run({
        command: "sh",
        args: [
          "-c",
          `. "${envFile}"; ${expand(app.down, { port: "", worker: input.name, worktree: worker.worktree })}`,
        ],
        cwd: worker.worktree,
      })
    }
    if (app?.database !== undefined && existsSync(envFile)) {
      run({
        command: "sh",
        args: [
          "-c",
          `. "${envFile}"; ${expand(app.database.drop, { port: "", worker: input.name, worktree: worker.worktree })}`,
        ],
        cwd: worker.worktree,
      })
    }
    // The address names the substrate: an hc terminal, a Rex session, or a tab in one.
    // Stopping the one the worker actually got is the difference between a stopped worker and a
    // vanished room entry.
    if (worker.address.startsWith("window:")) {
      const rex = Result.getOrUndefined(onPath("rex"))
      if (rex !== undefined) run({ command: rex, args: ["window", "close", worker.address] })
    } else if (worker.address.startsWith("session:")) {
      const rex = Result.getOrUndefined(onPath("rex"))
      if (rex !== undefined) run({ command: rex, args: ["kill", worker.address] })
    } else {
      if (hc === undefined) return yield* Effect.fail("herdr-core is not installed (hc)")
      run({ command: hc, args: ["kill", worker.address] })
      const appAddress = worker.appAddress
      if (appAddress !== undefined) run({ command: hc, args: ["kill", appAddress] })
    }
    removeWorktree({ root: config.repo.root, dir: worker.worktree })
    yield* Effect.tryPromise({
      try: () => new RoomClient(roomUrl(), config.room).stopWorker(input.name),
      catch: () => "room not reachable",
    }).pipe(Effect.orElseSucceed(() => ({ ok: false })))
    return input.name
  })

/**
 * Attach to a worker session through herdr-core.
 *
 * @param input - The repository and the worker name.
 * @returns The worker's address, or why it could not attach.
 */
export const attachWorker = (input: {
  readonly cwd: string
  readonly name: string
}): Effect.Effect<string, string, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const hc = Option.getOrUndefined(hcOf())
    const root = Option.getOrUndefined(valueOf(topLevel(input.cwd))) ?? input.cwd
    const config = Result.getOrUndefined(yield* readConfig(findConfigPath(root)))
    if (config === undefined) return yield* Effect.fail("no room.config.json in this repository")
    const workers = yield* Effect.tryPromise({
      try: () => new RoomClient(roomUrl(), config.room).workers(),
      catch: () => "room not reachable",
    }).pipe(Effect.orElseSucceed((): WorkerList => ({ workers: [] })))
    const worker = workers.workers.find((entry) => entry.name === input.name)
    if (worker === undefined) return yield* Effect.fail(`no worker named ${input.name}`)
    if (worker.address.startsWith("window:")) {
      const rex = Result.getOrUndefined(onPath("rex"))
      const focused =
        rex === undefined
          ? undefined
          : run({ command: rex, args: ["window", "focus", worker.address] })
      return focused?.code === 0
        ? `rex tab ${worker.address} · focused`
        : `rex tab ${worker.address} — focus it with: rex window focus ${worker.address}`
    }
    // Rex has no "attach": a session id is shown by asking the app to select it.
    if (worker.address.startsWith("session:")) {
      return (
        `rex session ${worker.address} — show it with: ` +
        `rex -C <client> do session.select session_id=${worker.address}`
      )
    }
    if (hc === undefined) return yield* Effect.fail("herdr-core is not installed (hc)")
    const result = yield* Effect.sync(() => run({ command: hc, args: ["attach", worker.address] }))
    return result.code === 0 ? worker.address : `attach exited ${result.code}`
  })

/** Re-exported for the picker. */
export { roomsByActivity }
