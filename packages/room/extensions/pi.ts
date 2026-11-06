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
 * This file is not typechecked by the package (Pi strips types itself), and jig's plumb engine
 * excludes `packages/room/extensions/**` (jig.config.json), so the boundary narrows with the
 * primitives the Pi runtime has rather than Effect Schema. The Pi editor import stays dynamic so
 * the module loads without the host package.
 *
 * Identity lives on the context, not on `pi`: `ctx.sessionManager.getSessionId()` and
 * `ctx.sessionManager.getCwd()` are the session's id and directory, while `pi.getSessionName` /
 * `pi.setSessionName` are the human label. The name is not an identity — two sessions can share
 * one, and an unnamed session reports "unnamed" — so a binding keyed by it goes dormant with no
 * symptom. `jig room session --attach` records the id for exactly that reason.
 *
 * A throw inside `session_start` kills this extension silently, and a surface that dies on load
 * looks exactly like one that is asleep. Guard an optional host API with a typeof check rather
 * than trusting that the object named in the docs is the one that carries it.
 */
import { execFile, spawn } from "node:child_process"
import { existsSync, readFileSync, watch } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Type } from "typebox"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

const run = promisify(execFile)
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Restart this extension runtime when its own file changes.
 *
 * `/reload` re-reads auto-discovered extensions; this one is usually loaded with `pi -e`, which
 * reload ignores — so the loop was "edit pi.ts, then quit and start the session again". The
 * watcher calls the same `ctx.reload()`. It is behind `ROOM_DEV_WATCH` because a shipped
 * extension must never restart somebody's session on its own, and a reload tears down every
 * extension runtime for that session, not just this one.
 */
const watchSelf = (ctx: ExtensionContext): { readonly close: () => void } | undefined => {
  const file = fileURLToPath(import.meta.url)
  let pending: ReturnType<typeof setTimeout> | undefined
  try {
    const watcher = watch(file, () => {
      if (pending !== undefined) clearTimeout(pending)
      // A save writes twice (truncate, then content); one reload per save is the point.
      pending = setTimeout(() => {
        pending = undefined
        void ctx.reload()
      }, 250)
    })
    return {
      close: () => {
        if (pending !== undefined) clearTimeout(pending)
        watcher.close()
      },
    }
  } catch {
    return undefined
  }
}

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
      continue
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

/** The tool name on a tool event, without asserting a shape the event did not promise. */
const toolNameOf = (event: unknown): string =>
  typeof event === "object" &&
  event !== null &&
  "toolName" in event &&
  typeof event.toolName === "string"
    ? event.toolName
    : ""

/** One streamed entry, or nothing when the line is not one. */
const parsedEntry = (
  line: string,
): { readonly kind: string; readonly text: string } | undefined => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  if (!("kind" in value) || typeof value.kind !== "string") return undefined
  if (!("text" in value) || typeof value.text !== "string") return undefined
  return { kind: value.kind, text: value.text }
}

/** A room as the machine's index lists it; `name` is the label a person picks by. */
interface IndexRoom {
  readonly room: string
  readonly name: string
  readonly stage: string
  readonly lastSeen?: number
}

/** How many rows the picker shows before it pages. */
const PICKER_ROWS = 10

/**
 * How long ago a room was last opened, in the few characters a row can afford.
 *
 * A room with no recorded activity says "never" rather than a date in 1970: the index writes
 * `0` for "not yet", and `ago` must not turn that into a fact.
 */
const ago = (lastSeen: number | undefined): string => {
  if (lastSeen === undefined || lastSeen <= 0) return "never"
  const minutes = Math.round((Date.now() - lastSeen) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Whether a typed filter matches a room: a case-insensitive subsequence of its name or stage.
 *
 * `dmv` finds `data-migration-v1`, which a prefix filter cannot. SelectList's own `setFilter`
 * matches a prefix, so which rows it is given is this function's decision, not its own.
 */
const fuzzy = (query: string, room: IndexRoom): boolean => {
  const needle = query.toLowerCase()
  return [room.name.toLowerCase(), room.stage.toLowerCase()].some((haystack) => {
    let at = 0
    for (const character of needle) {
      const found = haystack.indexOf(character, at)
      if (found < 0) return false
      at = found + 1
    }
    return true
  })
}

/** One room row: where it lives, whether it is this repository's, and when it was last opened. */
const describeRoom = (room: IndexRoom, here: string | undefined): string => {
  const parts = [room.stage]
  if (room.name === here) parts.push("this repo")
  parts.push(`last seen ${ago(room.lastSeen)}`)
  return parts.join(" · ")
}

/** The component a custom screen hands back: a text cursor, and the list under it. */
interface PickComponent {
  focused: boolean
  readonly capturesViewportInput: boolean
  render(width: number): string[]
  invalidate(): void
  handleInput(data: string): void
}

/**
 * Pick a room: a filter line over the machine's rooms, instead of a paragraph to read.
 *
 * Typing narrows (a subsequence, so the middle of a project name works), up and down move,
 * enter selects, escape cancels. SelectList draws the rows, so truncation, paging, wrapping and
 * the scroll indicator stay the host's; this owns only the filter and the selected index, which
 * are the two things a type-to-filter picker has to own once its filter is not a prefix match.
 */
const pickRoom = async (
  ctx: ExtensionContext,
  rooms: ReadonlyArray<IndexRoom>,
  here: string | undefined,
): Promise<IndexRoom | undefined> => {
  const tui = await import("@earendil-works/pi-tui")
  const picked = await ctx.ui.custom<IndexRoom | null>(
    (screen, theme, keybindings, done) => {
      const input = new tui.Input({ prompt: "room › ", placeholder: "type to filter" })
      const heading = new tui.Text(theme.fg("accent", theme.bold("rooms on this machine")))
      const hint = new tui.Text(theme.fg("dim", "↑↓ move · enter select · esc cancel"))
      const listTheme = {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      }
      const shown = (query: string): ReadonlyArray<IndexRoom> =>
        query === "" ? rooms : rooms.filter((room) => fuzzy(query, room))
      // Start on this repository's room when there is one: the common case is "the one here".
      let selected = Math.max(
        0,
        rooms.findIndex((room) => room.name === here),
      )
      const component: PickComponent = {
        focused: false,
        capturesViewportInput: true,
        render(width: number): string[] {
          const query = input.getValue()
          const visible = shown(query)
          input.focused = component.focused
          const rows = visible.map((room) => ({
            value: room.name,
            label: room.name,
            description: describeRoom(room, here),
          }))
          // SelectList's own empty state says "No matching commands" -- its wording for pi's
          // command palette, not for a list of rooms, so an unmatched filter is said here.
          if (rows.length === 0) {
            return [
              ...heading.render(width),
              ...input.render(width),
              theme.fg("warning", `  no room matches "${query}"`),
              ...hint.render(width),
            ]
          }
          const list = new tui.SelectList(rows, Math.min(rows.length, PICKER_ROWS), listTheme)
          list.setSelectedIndex(Math.min(selected, rows.length - 1))
          return [
            ...heading.render(width),
            ...input.render(width),
            ...list.render(width),
            ...hint.render(width),
          ]
        },
        invalidate(): void {},
        handleInput(data: string): void {
          const query = input.getValue()
          const count = shown(query).length
          if (keybindings.matches(data, "tui.select.cancel")) {
            done(null)
            return
          }
          if (keybindings.matches(data, "tui.select.up")) {
            if (count > 0) selected = (selected + count - 1) % count
            screen.requestRender()
            return
          }
          if (keybindings.matches(data, "tui.select.down")) {
            if (count > 0) selected = (selected + 1) % count
            screen.requestRender()
            return
          }
          if (keybindings.matches(data, "tui.select.confirm")) {
            const row = shown(query)[Math.min(selected, Math.max(0, count - 1))]
            if (row !== undefined) done(row)
            return
          }
          input.handleInput(data)
          // A narrower list has a different row under the cursor; start at its first.
          if (input.getValue() !== query) selected = 0
          screen.requestRender()
        },
      }
      return component
    },
    { blocked: { kind: "question", message: "choosing a room" } },
  )
  return picked ?? undefined
}

export default function roomExtension(pi: ExtensionAPI): void {
  let active: string | undefined
  let badge: ReadonlyArray<string> = []
  let timer: ReturnType<typeof setInterval> | undefined
  let selfWatch: { readonly close: () => void } | undefined
  let follower: ReturnType<typeof spawn> | undefined

  const refresh = async (ctx: ExtensionContext): Promise<void> => {
    const cwd = cwdOf(ctx)
    const config = roomOf(cwd)
    if (config === undefined && active === undefined) {
      badge = []
      return
    }
    const named = active === undefined ? [] : ["--room", active]
    const view = await json<SessionView>(["session", "--cwd", cwd, ...named, "--json"], cwd)
    badge = badgeOf(active === undefined ? config : { room: active, name: active }, view)
    if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.requestRender?.()
  }

  const attach = async (ctx: ExtensionContext): Promise<void> => {
    const cwd = cwdOf(ctx)
    if (roomOf(cwd) === undefined && active === undefined) return
    if (follower !== undefined) return
    const { command, args } = launcher()
    // The room the person picked, not only the one this directory holds: `detach()` then
    // `attach()` is what a selection does, so the stream follows what the badge says.
    // --no-replay: a batch becomes a message in this session's transcript, so delivering the
    // entries already in the conversation means appending the room's whole history again on
    // every resume. The badge and the tools answer "what happened" on request; this stream is
    // for what happens next.
    const child = spawn(
      command,
      [
        ...args,
        "session",
        "--cwd",
        cwd,
        ...(active === undefined ? [] : ["--room", active]),
        "--watch",
        "--no-replay",
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
    follower = child
    let buffer = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString()
      let index = buffer.indexOf("\n")
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf("\n")
        const entry = parsedEntry(line)
        if (entry === undefined) continue
        const speaker = entry.kind === "pi.user" ? "you" : "room"
        // `nextTurn`, not `followUp`: a note is a fact from the room, not a turn, so it must not
        // start a run -- but `followUp` with `triggerTurn: false` on an idle session dropped it
        // entirely (the transcript never showed it), and `nextTurn` is the mode documented to
        // queue without interrupting.
        pi.sendMessage(
          {
            customType: "room.session",
            content: `[${speaker}] ${entry.text}`,
            display: true,
          },
          { deliverAs: "nextTurn" },
        )
      }
    })
  }

  const detach = (): void => {
    follower?.kill()
    follower = undefined
  }

  const roomsOf = async (cwd: string): Promise<ReadonlyArray<IndexRoom>> =>
    (await json<ReadonlyArray<IndexRoom>>(["list", "--json"], cwd)) ?? []

  /**
   * Make a room the one this session talks to and follows.
   *
   * The badge, the tools and the message stream are three readers of one choice, so the stream
   * is restarted rather than left on the room the session started in: a person who picks a room
   * and then sees its messages arrive from a different room has been lied to.
   */
  const select = async (ctx: ExtensionContext, name: string): Promise<void> => {
    const cwd = cwdOf(ctx)
    active = name
    await refresh(ctx)
    detach()
    await attach(ctx)
    const view = await json<SessionView>(["session", "--cwd", cwd, "--room", name, "--json"], cwd)
    ctx.ui.notify(
      view === undefined
        ? `room ${name}: not attached`
        : `room ${name} · ${view.id} · ${view.busy ? "busy" : (view.runFailure ?? "idle")}`,
      "info",
    )
  }

  pi.registerCommand("room", {
    description: "Pick a room on this machine, or say something into the one in this repository.",
    handler: async (args, ctx) => {
      const text = (args ?? "").trim()
      const cwd = cwdOf(ctx)
      const config = roomOf(cwd)
      if (text === "") {
        const rooms = await roomsOf(cwd)
        if (rooms.length === 0) {
          ctx.ui.notify("no rooms yet -- run `jig room plan` in a repository", "info")
          return
        }
        if (!(ctx.mode === "tui" && ctx.hasUI)) {
          // No picker to open, so print the same rows it would have shown and name the command
          // that takes one directly.
          ctx.ui.notify(
            [
              "rooms:",
              ...rooms.map((room) => `  ${room.name}  ${describeRoom(room, config?.name)}`),
              "/room use <name>",
            ].join("\n"),
            "info",
          )
          return
        }
        const picked = await pickRoom(ctx, rooms, config?.name)
        if (picked === undefined) return
        await select(ctx, picked.name)
        return
      }
      if (config === undefined && active === undefined) {
        const rooms = await roomsOf(cwd)
        ctx.ui.notify(
          rooms.length === 0
            ? "no rooms yet -- run `jig room plan` in a repository"
            : [
                "rooms:",
                ...rooms.map((room) => `  ${room.name}  ${room.stage}`),
                "/room use <name>",
              ].join("\n"),
          "info",
        )
        return
      }
      if (text.startsWith("use ")) {
        const name = text.slice("use ".length).trim()
        const rooms = await roomsOf(cwd)
        if (!rooms.some((room) => room.name === name)) {
          ctx.ui.notify(`room use: no room named ${name} -- \`jig room list\` shows them`, "info")
          return
        }
        await select(ctx, name)
        return
      }
      if (text.startsWith("say ")) {
        const said = text.slice("say ".length).trim()
        if (said === "") {
          ctx.ui.notify("room say: nothing to say", "info")
          return
        }
        // Offer it to the room the person picked, not to whatever this directory holds.
        const outcome = await invoke(
          [
            "session",
            "--cwd",
            cwd,
            ...(active === undefined ? [] : ["--room", active]),
            "--say",
            said,
          ],
          cwd,
        )
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

  /** The room's durable conversation as one answer: the view, then the last entries. */
  /** The room's durable conversation as one answer: the view, then the last entries. */
  pi.registerTool({
    name: "room_session",
    description:
      "Read the room's durable conversation: its id, whether a run is working, why the last run stopped, and the most recent entries (a review comment, a Linear change, a broadcast the surface recorded). Use it when the person asks what happened in the room or what is queued.",
    parameters: Type.Object({
      recent: Type.Optional(Type.Number({ description: "How many entries to read. Default 10." })),
      all: Type.Optional(
        Type.Boolean({
          description:
            "Include the surface's own telemetry (room.edit, room.session) as well as talk.",
        }),
      ),
      room: Type.Optional(
        Type.String({ description: "A room name from the index. Default: this repository's." }),
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const cwd = cwdOf(ctx)
      const name = params.room ?? active
      const recent = params.recent === undefined ? "10" : String(params.recent)
      const view = await json<{
        readonly view?: SessionView
        readonly entries?: ReadonlyArray<{ readonly kind: string; readonly text: string }>
      }>(
        [
          "session",
          "--cwd",
          cwd,
          ...(name === undefined ? [] : ["--room", name]),
          "--json",
          "--recent",
          recent,
          ...(params.all === true ? ["--all"] : []),
        ],
        cwd,
      )
      if (view?.view === undefined) {
        return {
          content: [
            { type: "text" as const, text: "room session: no room here (run `jig room plan`)" },
          ],
          details: undefined,
        }
      }
      const head = `session ${view.view.id} · ${view.view.runFailure ?? (view.view.busy ? "busy" : "idle")} · ${view.view.queued} queued`
      const lines = (view.entries ?? []).map(
        (entry) => `${entry.kind.padEnd(14)} ${entry.text.replaceAll("\n", " ")}`,
      )
      return {
        content: [{ type: "text" as const, text: [head, ...lines].join("\n") }],
        details: undefined,
      }
    },
  })

  /** Record a fact deliberately: a write, so the model never sees it as a prompt. */
  pi.registerTool({
    name: "room_note",
    description:
      "Record a fact in the room's durable conversation without asking the model anything (a write, not an input). Use it for decisions the surface cannot infer: a rename, a migration, a deliberate deferral. The automatic hooks already record edits and session close.",
    parameters: Type.Object({
      kind: Type.String({ description: "Entry kind, for example room.decision." }),
      data: Type.Optional(Type.String({ description: "JSON payload. Default {}." })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const cwd = cwdOf(ctx)
      const args = ["session", "--cwd", cwd, "--note", params.kind]
      if (params.data !== undefined) args.push("--data", params.data)
      if (active !== undefined) args.push("--room", active)
      const text = await invoke(args, cwd)
      return {
        content: [{ type: "text" as const, text: text ?? "room note: not recorded" }],
        details: undefined,
      }
    },
  })

  /** What `room init` would write: nothing is applied. */
  pi.registerTool({
    name: "room_plan",
    description:
      "Read the room setup plan for this repository without writing anything: the Linear project, the GitHub label, the ingress, and the room name it would use. Show it to the person; `room_init` applies it only after they approve.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
      const cwd = cwdOf(ctx)
      const text = await invoke(["plan", "--cwd", cwd, "--json"], cwd)
      return {
        content: [{ type: "text" as const, text: text ?? "room plan: no plan" }],
        details: undefined,
      }
    },
  })

  /** Apply the plan. Writes room.config.json and registers the room. */
  pi.registerTool({
    name: "room_init",
    description:
      "Write room.config.json and register the room. Run only after a human approved the plan from room_plan: it creates a committed file and records the room in this machine's index. It does not create webhooks; `room webhook --create` does that for a deployed room.",
    parameters: Type.Object({
      room: Type.String({ description: "Room name, for example multi-season." }),
      project: Type.Optional(
        Type.String({ description: "Linear project id (linearis projects list)." }),
      ),
      projectName: Type.Optional(
        Type.String({ description: "Linear project name, as a person reads it." }),
      ),
      label: Type.Optional(
        Type.String({
          description:
            "The GitHub label this room watches; with no Linear project, the label is also its address.",
        }),
      ),
      linearUser: Type.Optional(
        Type.String({ description: "The Linear display name for this person." }),
      ),
      stage: Type.Optional(
        Type.String({ description: "Where the room runs. Default local/<login>." }),
      ),
      force: Type.Optional(Type.Boolean({ description: "Rewrite an existing room.config.json." })),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const cwd = cwdOf(ctx)
      const args = ["init", "--cwd", cwd, "--room", params.room]
      if (params.project !== undefined) args.push("--linear-project", params.project)
      if (params.projectName !== undefined) args.push("--linear-name", params.projectName)
      if (params.label !== undefined) args.push("--label", params.label)
      if (params.linearUser !== undefined) args.push("--linear-user", params.linearUser)
      if (params.stage !== undefined) args.push("--stage", params.stage)
      if (params.force === true) args.push("--force")
      const text = await invoke(args, cwd)
      return {
        content: [{ type: "text" as const, text: text ?? "room init: not applied" }],
        details: undefined,
      }
    },
  })

  pi.registerTool({
    name: "room_board",
    description:
      "Read the project room's board: running, queued and failed review jobs, delivery waiting, and which hosts are present. Use it when the person asks what is reviewable or who is on what.",
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
      const cwd = cwdOf(ctx)
      const text = await invoke(["board", "--cwd", cwd, "--json"], cwd)
      return {
        content: [{ type: "text" as const, text: text ?? "room: no board (run `jig room plan`)" }],
        details: undefined,
      }
    },
  })

  /**
   * Record a fact in the durable conversation without asking the model anything.
   *
   * This is the automatic broadcast the brief called for: a hook fires, the entry lands. An
   * agent that had to *choose* to broadcast would sometimes not, so the surface does it and the
   * agent never sees it as a prompt.
   */
  const note = async (
    ctx: ExtensionContext,
    kind: string,
    data: Record<string, string>,
  ): Promise<void> => {
    const cwd = cwdOf(ctx)
    if (roomOf(cwd) === undefined) return
    await invoke(["session", "--cwd", cwd, "--note", kind, "--data", JSON.stringify(data)], cwd)
  }

  /**
   * Edits are broadcast in batches, not one note per tool call.
   *
   * One note per edit buried the conversation (19 of 29 entries in a live room were room.edit)
   * and made every edit's latency depend on roomd answering. A batch says the same thing once
   * per window, and it is fire-and-forget: a room that is down must not slow an edit.
   */
  let pendingEdits = 0
  let editTimer: ReturnType<typeof setTimeout> | undefined
  const flushEdits = (ctx: ExtensionContext): void => {
    if (editTimer !== undefined) {
      clearTimeout(editTimer)
      editTimer = undefined
    }
    if (pendingEdits === 0) return
    const count = String(pendingEdits)
    pendingEdits = 0
    void note(ctx, "room.edit", { count })
  }

  pi.on("tool_execution_end", (event, ctx) => {
    const name = toolNameOf(event)
    if (name !== "edit" && name !== "write") return
    pendingEdits += 1
    if (pendingEdits >= 25) {
      flushEdits(ctx)
      return
    }
    if (editTimer !== undefined) return
    editTimer = setTimeout(() => {
      editTimer = undefined
      flushEdits(ctx)
    }, 60_000)
    editTimer.unref?.()
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
    // Dev loop only: saving this file reloads the extension runtime, the same flow /reload runs.
    if (process.env.ROOM_DEV_WATCH === "1") selfWatch = watchSelf(ctx)
  })

  pi.on("session_shutdown", async (_event, ctx) => {
    flushEdits(ctx)
    await note(ctx, "room.session", { event: "close" })
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    selfWatch?.close()
    selfWatch = undefined
    detach()
  })
}
