/**
 * The room, in Pi's terminal.
 *
 * A widget above the editor, a `/room` picker, and a `room_board` tool. Everything is read
 * by shelling out to the `room` CLI — the same rule as jig's extension: this file owns no
 * projection and re-implements no report, so the model and the terminal get the same bytes.
 *
 * This file is not typechecked by the package (Pi strips types itself, and `tsconfig.json`
 * includes `src` only), which is why it uses `any` at the JSON boundary rather than the
 * Effect schemas the CLI uses.
 */
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Type } from "typebox"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const run = promisify(execFile)
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const onPath = (name: string): string | undefined => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const launcher = (): { command: string; args: ReadonlyArray<string> } => {
  const override = process.env.ROOM_BIN
  if (override !== undefined && override !== "") return { command: override, args: [] }
  const global = onPath("room")
  if (global !== undefined) return { command: global, args: [] }
  // `process.execPath` can be Pi's own binary, not Node. Ask PATH first, exactly as jig's
  // OpenCode plugin does; otherwise `node <cli>` runs Pi with the CLI as an argument.
  const node = onPath("node") ?? process.execPath
  const built = join(packageRoot, "dist", "cli.js")
  if (existsSync(built)) return { command: node, args: [built] }
  return {
    command: node,
    args: ["--conditions=development", join(packageRoot, "src", "cli.ts")],
  }
}

const invoke = async (args: ReadonlyArray<string>, cwd: string): Promise<string | undefined> => {
  const { command, args: prefix } = launcher()
  try {
    const { stdout } = await run(command, [...prefix, ...args], { cwd, maxBuffer: 8 * 1024 * 1024 })
    return stdout.trim()
  } catch {
    return undefined
  }
}

const json = async <T>(args: ReadonlyArray<string>, cwd: string): Promise<T | undefined> => {
  const text = await invoke(args, cwd)
  if (text === undefined || text === "") return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

interface BoardView {
  readonly name?: string
  readonly stage?: string
  readonly reachable?: boolean
  readonly jobs?: ReadonlyArray<{ state: string }>
  readonly chits?: ReadonlyArray<{ state: string; count: number }>
  readonly presence?: ReadonlyArray<{ host: string }>
}

const count = (jobs: BoardView["jobs"], state: string): number =>
  (jobs ?? []).filter((job) => job.state === state).length

const linesOf = (view: BoardView | undefined): ReadonlyArray<string> => {
  if (view === undefined || view.name === undefined) {
    return ["room  none here", "      /room to join · jig room plan"]
  }
  if (view.reachable === false) {
    const head = `room  ${view.name} · ${view.stage ?? ""}`
    return [head, "      roomd not running · jig room dev"]
  }
  const head = `room  ${view.name} · ${view.stage ?? ""}`
  const jobs = `jobs  running ${count(view.jobs, "running")} · queued ${count(view.jobs, "queued")} · failed ${count(view.jobs, "failed")}`
  const chits = `chits ${(view.chits ?? []).map((entry) => `${entry.state} ${entry.count}`).join(" · ") || "none"}`
  const here = `here  ${(view.presence ?? []).map((entry) => entry.host).join(" · ") || "nobody"}`
  return [head, jobs, chits, here]
}

// A tool's context does not always carry `cwd` (the runtime gives the process's), so fall
// back to it rather than passing `undefined` into the CLI.
const cwdOf = (ctx: { cwd?: string }): string => ctx.cwd ?? process.cwd()

const boardArgs = (cwd: string, room: string | undefined): ReadonlyArray<string> => [
  "board",
  "--cwd",
  cwd,
  ...(room === undefined ? [] : ["--room", room]),
  "--json",
]

interface RoomConfigFile {
  readonly room: string
}

const roomOf = (cwd: string): RoomConfigFile | undefined => {
  try {
    const value = JSON.parse(readFileSync(join(cwd, ".room", "config.json"), "utf8")) as {
      room?: unknown
    }
    return typeof value.room === "string" ? { room: value.room } : undefined
  } catch {
    return undefined
  }
}

const baseUrl = (): string => process.env.ROOM_URL ?? "http://127.0.0.1:9876"

const roomFetch = async (cwd: string, path: string, init?: RequestInit): Promise<unknown> => {
  const config = roomOf(cwd)
  if (config === undefined) return undefined
  const response = await fetch(`${baseUrl()}/r/${encodeURIComponent(config.room)}${path}`, init)
  return response.ok ? response.json() : undefined
}

interface InboxItem {
  readonly seq: number
  readonly kind: "turn" | "card"
  readonly text: string
}

export default function roomExtension(pi: ExtensionAPI): void {
  let active: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let inboxTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let cursor = 0

  const refresh = async (ctx: ExtensionContext): Promise<void> => {
    const view = await json<BoardView>(boardArgs(cwdOf(ctx), active), cwdOf(ctx))
    if (ctx.mode === "tui" && ctx.hasUI) {
      ctx.ui.setWidget("room", [...linesOf(view)], { placement: "aboveEditor" })
    }
  }

  pi.registerCommand("room", {
    description: "Join a room, or show the one this repository is in.",
    handler: async (_args, ctx) => {
      const rooms =
        (await json<ReadonlyArray<{ name: string; stage: string }>>(
          ["list", "--json"],
          cwdOf(ctx),
        )) ?? []
      if (rooms.length === 0) {
        ctx.ui.notify("no rooms yet — run `jig room plan` in a repository", "info")
        return
      }
      const choice = await ctx.ui.select(
        "Room",
        rooms.map((room) => `${room.name}  ${room.stage}`),
      )
      if (choice === undefined) return
      const index = rooms.findIndex((room) => choice.startsWith(`${room.name} `))
      active = index === -1 ? undefined : rooms[index]?.name
      await refresh(ctx)
      ctx.ui.notify(`room: ${active ?? "this repository"}`, "info")
    },
  })

  pi.registerCommand("board", {
    description: "Refresh the room board above the editor.",
    handler: async (_args, ctx) => {
      await refresh(ctx)
      const view = await json<BoardView>(boardArgs(cwdOf(ctx), active), cwdOf(ctx))
      const text = linesOf(view).join("\n")
      ctx.ui.notify(text, "info")
    },
  })

  pi.registerTool({
    name: "room_board",
    description:
      "Read the project room's board: the running, queued and failed review jobs, the chit counts by state, and which hosts are present. Use it when the person asks what is reviewable or who is on what.",
    parameters: Type.Object({}),
    execute: async (_params, ctx) => {
      const text = await invoke(boardArgs(cwdOf(ctx), active), cwdOf(ctx))
      return {
        content: [{ type: "text" as const, text: text ?? "room: no board (run `jig room plan`)" }],
        details: undefined,
      }
    },
  })

  const drain = async (ctx: ExtensionContext): Promise<void> => {
    const cwd = cwdOf(ctx)
    const config = roomOf(cwd)
    if (config === undefined) return
    const value = (await roomFetch(cwd, `/inbox?after=${cursor}&limit=50`)) as
      | { items?: ReadonlyArray<InboxItem>; next?: number }
      | undefined
    if (value === undefined) return
    const items = value.items ?? []
    if (items.length === 0) {
      cursor = value.next ?? cursor
      return
    }
    const turns = items.filter((item) => item.kind === "turn")
    const cards = items.filter((item) => item.kind === "card")
    if (turns.length > 0) {
      pi.sendMessage(
        {
          customType: "room.event",
          content: `[room]\n\n${turns.map((item) => item.text).join("\n\n---\n\n")}`,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      )
    }
    if (cards.length > 0 && ctx.hasUI) {
      ctx.ui.notify(cards.map((item) => item.text).join("\n"), "info")
    }
    await roomFetch(cwd, "/inbox/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seqs: items.map((item) => item.seq) }),
    })
    cursor = value.next ?? items.at(-1)?.seq ?? cursor
  }

  pi.on("session_start", async (_event, ctx) => {
    const cwd = cwdOf(ctx)
    const id = ctx.sessionManager.getSessionId()
    const beat = async (): Promise<void> => {
      await roomFetch(cwd, "/session", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, at: Date.now() }),
      })
    }
    await beat()
    await refresh(ctx)
    timer = setInterval(() => {
      void refresh(ctx)
    }, 15_000)
    timer.unref?.()
    inboxTimer = setInterval(() => {
      void drain(ctx)
    }, 5_000)
    inboxTimer.unref?.()
    heartbeatTimer = setInterval(() => {
      void beat()
    }, 15_000)
    heartbeatTimer.unref?.()
  })

  pi.on("session_shutdown", async () => {
    if (timer !== undefined) clearInterval(timer)
    if (inboxTimer !== undefined) clearInterval(inboxTimer)
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    timer = undefined
    inboxTimer = undefined
    heartbeatTimer = undefined
  })
}
