/**
 * The room, in Pi's terminal.
 *
 * The session is a durable conversation (pi-durable), not a process this file keeps alive:
 * every surface opens the same storage, watches it, and submits into it. That is what makes
 * the room multiplayer — two people, two Pi sessions, one conversation — and it is why this
 * file has no heartbeat, no ownership claim, and no wake spawn.
 *
 * Three surfaces, all reading the CLI (the same rule as jig's extension: this file owns no
 * projection):
 *
 *   the editor's top border   room <name> ................ busy · queued · why it stopped
 *   /room say <text>          submit an input into the durable conversation
 *   room_board                the board's JSON, untouched
 *
 * This file is not typechecked by the package (Pi strips types itself), which is why the JSON
 * boundary uses structural types and the Pi editor import is dynamic.
 */
import { execFile, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
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
  const node = onPath("node") ?? process.execPath
  const built = join(packageRoot, "dist", "cli.js")
  if (existsSync(built)) return { command: node, args: [built] }
  return { command: node, args: ["--conditions=development", join(packageRoot, "src", "cli.ts")] }
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

/** What `room session --json` says about the durable conversation. */
interface SessionView {
  readonly id: string
  readonly busy: boolean
  readonly queued: number
  readonly runFailure?: string
}

interface BoardView {
  readonly name?: string
  readonly stage?: string
  readonly reachable?: boolean
  readonly jobs?: ReadonlyArray<{ state: string }>
  readonly workers?: ReadonlyArray<{ name: string; url?: string }>
}

interface RoomConfigFile {
  readonly room: string
  readonly name?: string
}

const roomOf = (cwd: string): RoomConfigFile | undefined => {
  for (const path of [join(cwd, "room.config.json"), join(cwd, ".room", "config.json")]) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as { room?: unknown; name?: unknown }
      if (typeof value.room === "string") {
        return typeof value.name === "string"
          ? { room: value.room, name: value.name }
          : { room: value.room }
      }
    } catch {
      // try the next location
    }
  }
  return undefined
}

const cwdOf = (ctx: { cwd?: string }): string => ctx.cwd ?? process.cwd()

/**
 * One line of border: `── left ───── right ──`, truncated to the width.
 *
 * The same shape pi's own border-status example uses, and the shape pi-fabric draws its
 * session badge in: a label in the editor's top border rather than a block above the editor.
 */
const fitBorder = (
  left: string,
  right: string,
  width: number,
  border: (text: string) => string,
  visible: (text: string) => number,
  truncate: (text: string, width: number) => string,
): string => {
  if (width <= 0) return ""
  if (width === 1) return border("─")
  let leftText = left
  let rightText = right
  const fixed = 2
  const gap = 3
  while (fixed + visible(leftText) + visible(rightText) + gap > width && visible(rightText) > 0) {
    rightText = truncate(rightText, Math.max(0, visible(rightText) - 1))
  }
  while (fixed + visible(leftText) + visible(rightText) + gap > width && visible(leftText) > 0) {
    leftText = truncate(leftText, Math.max(0, visible(leftText) - 1))
  }
  const fill = Math.max(0, width - fixed - visible(leftText) - visible(rightText))
  return border("─") + leftText + border("─".repeat(fill)) + rightText + border("─")
}

/** The badge: which room, and what its durable conversation is doing. */
const badgeOf = (
  config: RoomConfigFile | undefined,
  view: SessionView | undefined,
): ReadonlyArray<string> => {
  if (config === undefined) return []
  const state =
    view === undefined
      ? "not attached"
      : view.runFailure !== undefined
        ? `${view.runFailure}`
        : view.busy
          ? "busy"
          : view.queued > 0
            ? `${view.queued} queued`
            : "idle"
  return [` room ${config.name ?? config.room} `, ` ${state} `]
}

export default function roomExtension(pi: ExtensionAPI): void {
  let active: string | undefined
  let badge: ReadonlyArray<string> = []
  let timer: ReturnType<typeof setInterval> | undefined
  let follower: ReturnType<typeof spawn> | undefined

  const refresh = async (ctx: ExtensionContext): Promise<void> => {
    const cwd = cwdOf(ctx)
    const config = roomOf(cwd)
    if (config === undefined) {
      badge = []
      return
    }
    const view = await json<SessionView>(["session", "--cwd", cwd, "--json"], cwd)
    badge = badgeOf(config, view)
    if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.requestRender?.()
  }

  const attach = async (ctx: ExtensionContext): Promise<void> => {
    const cwd = cwdOf(ctx)
    if (roomOf(cwd) === undefined) return
    if (follower !== undefined) return
    const { command, args } = launcher()
    const child = spawn(command, [...args, "session", "--cwd", cwd, "--watch"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
    follower = child
    let buffer = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      let index = buffer.indexOf("\n")
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf("\n")
        const entry = (() => {
          try {
            return JSON.parse(line) as { kind?: string; text?: string }
          } catch {
            return undefined
          }
        })()
        if (entry?.text === undefined || entry.text === "") continue
        const speaker = entry.kind === "pi.user" ? "you" : "room"
        pi.sendMessage(
          {
            customType: "room.session",
            content: `[${speaker}] ${entry.text}`,
            display: true,
          },
          { deliverAs: "followUp", triggerTurn: false },
        )
      }
    })
  }

  const detach = (): void => {
    follower?.kill()
    follower = undefined
  }

  pi.registerCommand("room", {
    description: "Show the room's durable session, or say something into it.",
    handler: async (args, ctx) => {
      const text = (args ?? "").trim()
      const cwd = cwdOf(ctx)
      const config = roomOf(cwd)
      if (config === undefined) {
        ctx.ui.notify("no room here -- run `jig room plan` in a repository", "info")
        return
      }
      if (text.startsWith("say ")) {
        const said = text.slice("say ".length).trim()
        if (said === "") {
          ctx.ui.notify("room say: nothing to say", "info")
          return
        }
        const outcome = await invoke(["session", "--cwd", cwd, "--say", said], cwd)
        ctx.ui.notify(outcome ?? "room: the input was not admitted", "info")
        await refresh(ctx)
        return
      }
      await refresh(ctx)
      const view = await json<SessionView>(["session", "--cwd", cwd, "--json"], cwd)
      ctx.ui.notify(
        view === undefined
          ? `room ${config.name ?? config.room}: not attached`
          : `room ${config.name ?? config.room} · ${view.id} · ${view.busy ? "busy" : (view.runFailure ?? "idle")}`,
        "info",
      )
    },
  })

  pi.registerTool({
    name: "room_board",
    description:
      "Read the project room's board: running, queued and failed review jobs, delivery waiting, and which hosts are present. Use it when the person asks what is reviewable or who is on what.",
    parameters: Type.Object({}),
    execute: async (_params, ctx) => {
      const cwd = cwdOf(ctx)
      const text = await invoke(["board", "--cwd", cwd, "--json"], cwd)
      return {
        content: [{ type: "text" as const, text: text ?? "room: no board (run `jig room plan`)" }],
        details: undefined,
      }
    },
  })

  pi.on("session_start", async (_event, ctx) => {
    await refresh(ctx)
    await attach(ctx)
    if (ctx.mode === "tui" && ctx.hasUI) {
      const piModule = await import("@earendil-works/pi-coding-agent")
      const tui = await import("@earendil-works/pi-tui")
      class RoomBorderEditor extends piModule.CustomEditor {
        render(width: number): string[] {
          const lines = super.render(width)
          if (lines.length === 0) return lines
          const [left, right] = badge
          const borderColor = (text: string) => this.borderColor(text)
          if (left === undefined || right === undefined) return lines
          lines[0] = fitBorder(
            left,
            right,
            width,
            borderColor,
            (text) => tui.visibleWidth(text),
            (text, size) => tui.truncateToWidth(text, size, ""),
          )
          return lines
        }
      }
      ctx.ui.setEditorComponent(
        (tuiApi, theme, keybindings) => new RoomBorderEditor(tuiApi, theme, keybindings),
      )
    }
    timer = setInterval(() => {
      void refresh(ctx)
    }, 10_000)
    timer.unref?.()
  })

  pi.on("session_shutdown", async () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    detach()
  })
}
