import { Effect, Match, Option, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { ticks } from "foldkit-primitives/time"
import { copyOrSelect, type CopyOutcome } from "./copy.ts"

const Workstream = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  label: Schema.String,
  phase: Schema.String,
  path: Schema.String,
  repo: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  pr: Schema.optional(Schema.Finite),
  delivery: Schema.optional(Schema.String),
  linearProjectId: Schema.optional(Schema.String),
  checkpoint: Schema.Struct({ sha: Schema.String, at: Schema.String }),
})
const Desk = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  title: Schema.String,
  route: Schema.String,
})
const Report = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  kind: Schema.String,
  actual: Schema.String,
  at: Schema.String,
  blocked: Schema.Boolean,
})
const Quality = Schema.Struct({
  available: Schema.Boolean,
  errors: Schema.Finite,
  warnings: Schema.Finite,
  note: Schema.String,
})
const ActivityPass = Schema.Struct({
  pass: Schema.Finite,
  at: Schema.String,
  status: Schema.String,
  phase: Schema.String,
  events: Schema.Array(Schema.String),
  checkpoint: Schema.optional(Schema.String),
  exit: Schema.optional(Schema.Finite),
  quality: Schema.optional(
    Schema.Struct({ before: Quality, after: Quality, regressed: Schema.Boolean }),
  ),
})
const Activity = Schema.Struct({
  workstream: Schema.String,
  lastPass: Schema.NullOr(ActivityPass),
  pending: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      at: Schema.String,
      summary: Schema.optional(Schema.String),
    }),
  ),
  lastEvent: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      at: Schema.String,
      summary: Schema.optional(Schema.String),
    }),
  ),
  ageMinutes: Schema.NullOr(Schema.Finite),
})
const SessionSource = Schema.Union([Schema.Literal("herdr"), Schema.Literal("rex")])
const Session = Schema.Struct({
  source: SessionSource,
  address: Schema.String,
  agent: Schema.optional(Schema.String),
  roomId: Schema.optional(Schema.String),
  where: Schema.optional(Schema.String),
  workstream: Schema.optional(Schema.String),
})
const SessionSourceView = Schema.Struct({
  available: Schema.Boolean,
  sessions: Schema.Array(Session),
})
const Presence = Schema.Struct({
  factory: Schema.Struct({
    workstreams: Schema.Array(Workstream),
    activity: Schema.Array(Activity),
    desk: Schema.Array(Desk),
    reports: Schema.Array(Report),
  }),
  sessions: Schema.Struct({ herdr: SessionSourceView, rex: SessionSourceView }),
})
export type Presence = typeof Presence.Type

export const Model = Schema.Struct({
  presence: Schema.NullOr(Presence),
  error: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  /** Repos start open; a closed repo is a name, so a refresh keeps the page as it was. */
  closedRepos: Schema.Array(Schema.String),
  /** Workstreams start closed: the phone shows the summaries and opens one. */
  openWorkstreams: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedRefresh: {},
  Settled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
  ClickedCopy: { command: Schema.String, target: Schema.String },
  Copied: {},
  Selected: {},
  CopyFailed: { message: Schema.String },
  Ticked: {},
  ClickedOpen: { source: SessionSource, address: Schema.String },
  Opened: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
  ToggledWorkstream: { id: Schema.String },
  OpenedWorkstream: { id: Schema.String },
  ToggledRepo: { repo: Schema.String },
})
export type Message = typeof Message.Type

type UpdateReturn = Update.Return<Model, Message>

/** The Foldkit update function: every transition is explicit here. */
export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedRefresh: () => ({ model: { ...model, loading: true }, commands: [FetchPresence()] }),
    Ticked: () =>
      model.loading
        ? { model }
        : { model: { ...model, loading: true, notice: null }, commands: [FetchPresence()] },
    Settled: ({ value, error }) => {
      if (error !== null) return { model: { ...model, presence: null, error, loading: false } }
      const decoded = Schema.decodeUnknownResult(Presence)(value)
      return Result.isSuccess(decoded)
        ? { model: { ...model, presence: decoded.success, error: null, loading: false } }
        : { model: { ...model, presence: null, error: String(decoded.failure), loading: false } }
    },
    ClickedCopy: ({ command, target }) => ({
      model,
      commands: [CopyCommand({ text: command, target })],
    }),
    Copied: () => ({ model: { ...model, notice: "Copied the attach command" } }),
    Selected: () => ({
      model: { ...model, notice: "Selected the command — copy it from the selection" },
    }),
    CopyFailed: ({ message }) => ({
      model: { ...model, notice: "Could not copy: " + message },
    }),
    ToggledWorkstream: ({ id }) => ({
      model: { ...model, openWorkstreams: toggle(model.openWorkstreams, id) },
    }),
    OpenedWorkstream: ({ id }) => {
      const workstream = model.presence?.factory.workstreams.find((item) => item.id === id)
      const repo = workstream === undefined ? undefined : repoName(workstream)
      return {
        model: {
          ...model,
          openWorkstreams: add(model.openWorkstreams, id),
          closedRepos:
            repo === undefined
              ? model.closedRepos
              : model.closedRepos.filter((item) => item !== repo),
        },
      }
    },
    ToggledRepo: ({ repo }) => ({
      model: { ...model, closedRepos: toggle(model.closedRepos, repo) },
    }),
    ClickedOpen: ({ source, address }) => ({
      model,
      commands: [OpenSession({ source, address })],
    }),
    Opened: ({ ok, error }) => ({
      model: {
        ...model,
        notice: ok ? "Opened in its app" : "Could not open: " + (error ?? "unknown error"),
      },
    }),
  })

/** Start with a fetch and an empty model. */
export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: {
    presence: null,
    error: null,
    loading: true,
    notice: null,
    closedRepos: [],
    openWorkstreams: [],
  },
  commands: [FetchPresence()],
})

/** Disclosure state is presentation, not factory data; it lives in the Model so a tap can change it. */
const toggle = (values: ReadonlyArray<string>, value: string): ReadonlyArray<string> =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

const add = (values: ReadonlyArray<string>, value: string): ReadonlyArray<string> =>
  values.includes(value) ? values : [...values, value]

export const FetchPresence = Command.define("FetchPresence", {
  messages: [Message.Settled],
  execute: Effect.tryPromise({
    try: async () => {
      const response = await fetch("/presence")
      if (!response.ok) return Promise.reject("HTTP " + response.status)
      return await response.json()
    },
    catch: (cause) => String(cause),
  }).pipe(
    Effect.match({
      onFailure: (error) => Message.Settled({ value: null, error: String(error) }),
      onSuccess: (value) => Message.Settled({ value, error: null }),
    }),
  ),
})

export const OpenSession = Command.define("OpenSession", {
  args: { source: SessionSource, address: Schema.String },
  messages: [Message.Opened],
  execute: ({ source, address }: { readonly source: "herdr" | "rex"; readonly address: string }) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch("/open", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, address }),
        })
        if (!response.ok) return Promise.reject((await response.text()) || "open failed")
        return true
      },
      catch: (cause) => String(cause),
    }).pipe(
      Effect.match({
        onFailure: (error) => Message.Opened({ ok: false, error }),
        onSuccess: () => Message.Opened({ ok: true, error: null }),
      }),
    ),
})

/** Presence refreshes itself; the button is for impatience, not the only path. */
export const subscriptions = ticks<Model, Message>({
  intervalMs: () => Option.some(20_000),
  onTick: () => Message.Ticked(),
})

/** Selects the rendered command so iOS can copy it from the long-press menu. */
const selectCopyTarget = (target: string): boolean => {
  const element = document.querySelector("#" + target)
  if (element === null) return false
  const selection = window.getSelection()
  if (selection === null) return false
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/**
 * Copy runs as a Command: the clipboard write and the selection fallback are the
 * effect, and the outcome comes back as a Message update reduces.
 */
export const CopyCommand = Command.define("FactoryView.CopyCommand", {
  args: { text: Schema.String, target: Schema.String },
  messages: [Message.Copied, Message.Selected, Message.CopyFailed],
  execute: ({ text, target }: { readonly text: string; readonly target: string }) =>
    copyOrSelect({
      text,
      clipboard: navigator.clipboard,
      select: () => selectCopyTarget(target),
    }).pipe(Effect.map(copyOutcomeMessage)),
})

const copyOutcomeMessage = Match.type<CopyOutcome>().pipe(
  Match.when("copied", () => Message.Copied()),
  Match.when("selected", () => Message.Selected()),
  Match.when("unavailable", () =>
    Message.CopyFailed({ message: "no clipboard API and nothing to select" }),
  ),
  Match.exhaustive,
)

const phaseOrder = ["reconcile", "build", "land", "blocked", "done"] as const
const phaseName = {
  reconcile: "Reconcile",
  build: "Build",
  land: "Land",
  blocked: "Blocked",
  done: "Done",
} as const
const phaseLabel = (phase: string): string => {
  switch (phase) {
    case "reconcile":
      return phaseName.reconcile
    case "build":
      return phaseName.build
    case "land":
      return phaseName.land
    case "blocked":
      return phaseName.blocked
    case "done":
      return phaseName.done
    default:
      return phase
  }
}
const phaseDetail = (phase: string): string => {
  switch (phase) {
    case "reconcile":
      return "Compare Linear, GitHub and the checkpoint. No code changes."
    case "build":
      return "A foreman pass makes the work mergeable."
    case "land":
      return "The PR is ready; a human merges it."
    case "blocked":
      return "Waiting on a desk answer or an external dependency."
    case "done":
      return "The factory has no work left for this workstream."
    default:
      return ""
  }
}
const repoName = (ws: typeof Workstream.Type): string => ws.repo ?? "unknown repository"

const sessionCommand = (session: typeof Session.Type): string =>
  session.source === "herdr" ? "hc attach " + session.address : "rex block focus " + session.address

/** The command is rendered with this id; the selection fallback addresses it by name. */
const copyTargetId = (session: typeof Session.Type): string =>
  "copy-" + session.source + "-" + session.address.replace(/[^A-Za-z0-9_-]/g, "-")

const sessionRow = (h: HtmlBuilder<Message>, session: typeof Session.Type) => {
  const command = sessionCommand(session)
  const target = copyTargetId(session)
  return h.div(
    [h.Class("session")],
    [
      h.div(
        [h.Class("session-main")],
        [
          h.span([h.Class("session-id")], [session.source + " " + session.address]),
          h.span([h.Class("session-owner muted")], [session.where ?? session.agent ?? ""]),
        ],
      ),
      h.code([h.Class("session-command"), h.Id(target)], [command]),
      h.div(
        [h.Class("session-actions")],
        [
          h.button(
            [
              h.Class("action"),
              h.AriaLabel("Open " + session.source + " session " + session.address),
              h.OnClick(Message.ClickedOpen({ source: session.source, address: session.address })),
            ],
            ["Open"],
          ),
          h.button(
            [
              h.Class("action copy"),
              h.AriaLabel("Copy the attach command for " + session.address),
              h.OnClick(Message.ClickedCopy({ command, target })),
            ],
            ["Copy"],
          ),
        ],
      ),
    ],
  )
}

const formatAge = (minutes: number | null): string => {
  if (minutes === null) return "unknown"
  if (minutes < 1) return "just now"
  if (minutes < 60) return minutes + "m ago"
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h " + (minutes % 60) + "m ago"
  return Math.floor(hours / 24) + "d ago"
}

const activityBlock = (h: HtmlBuilder<Message>, activity: typeof Activity.Type | undefined) => {
  if (activity === undefined)
    return h.div([h.Class("activity")], [h.span([h.Class("muted")], ["No pass records yet"])])
  const pass = activity.lastPass
  const running = pass?.status === "running"
  const stale = !running && (activity.ageMinutes ?? 0) >= 30
  const status = running
    ? "running"
    : pass === null
      ? "no pass yet"
      : "last pass #" + pass.pass + " " + pass.status
  return h.div(
    [h.Class("activity" + (stale ? " stale" : "") + (running ? " running" : ""))],
    [
      h.div(
        [h.Class("activity-head")],
        [
          h.span([h.Class("activity-status")], [status]),
          h.span([h.Class("muted")], [running ? "in flight" : formatAge(activity.ageMinutes)]),
          stale ? h.span([h.Class("stale-flag")], ["stale"]) : h.span([], []),
        ],
      ),
      h.div(
        [h.Class("activity-meta")],
        [
          pass?.quality === undefined
            ? h.span([], ["no quality record"])
            : h.span(
                [],
                [
                  "jig " +
                    pass.quality.after.errors +
                    " error / " +
                    pass.quality.after.warnings +
                    " warn",
                ],
              ),
          h.span(
            [],
            [
              activity.pending.length === 0
                ? "no queued events"
                : "queued: " +
                  activity.pending
                    .map(
                      (event) =>
                        event.kind + (event.summary === undefined ? "" : ": " + event.summary),
                    )
                    .join(" · "),
            ],
          ),
          activity.lastEvent === null
            ? h.span([], ["no events yet"])
            : h.span(
                [],
                [
                  "last event " +
                    activity.lastEvent.kind +
                    (activity.lastEvent.summary === undefined
                      ? ""
                      : ": " + activity.lastEvent.summary),
                ],
              ),
        ],
      ),
    ],
  )
}

const workstreamCard = (
  h: HtmlBuilder<Message>,
  ws: typeof Workstream.Type,
  activity: typeof Activity.Type | undefined,
  sessions: ReadonlyArray<typeof Session.Type>,
  open: boolean,
) =>
  h.article(
    [h.Class("workstream" + (open ? " open" : "")), h.Id(ws.id)],
    [
      h.button(
        [
          h.Class("workstream-toggle"),
          h.AriaExpanded(open),
          h.AriaLabel((open ? "Hide " : "Show ") + ws.label + " details"),
          h.OnClick(Message.ToggledWorkstream({ id: ws.id })),
        ],
        [
          h.span(
            [h.Class("workstream-title")],
            [
              h.span([h.Class("workstream-name")], [ws.label]),
              h.span([h.Class("mono muted workstream-id")], [ws.id]),
            ],
          ),
          h.span([h.Class("phase-pill " + ws.phase)], [phaseLabel(ws.phase) ?? ws.phase]),
          h.span([h.Class("chevron"), h.AriaHidden(true)], [open ? "▾" : "▸"]),
        ],
      ),
      h.div(
        [h.Class("workstream-meta")],
        [
          ws.repo === undefined
            ? h.span([], ["unknown repo"])
            : h.a(
                [h.Href("https://github.com/" + ws.repo), h.Target("_blank"), h.Rel("noreferrer")],
                [ws.repo],
              ),
          h.span([], [ws.branch ?? "no branch"]),
          ws.pr === undefined
            ? h.span([], ["trunk"])
            : h.a(
                [
                  h.Href("https://github.com/" + (ws.repo ?? "") + "/pull/" + ws.pr),
                  h.Target("_blank"),
                  h.Rel("noreferrer"),
                ],
                ["PR #" + ws.pr],
              ),
          h.span([h.Class("mono")], ["checkpoint " + ws.checkpoint.sha.slice(0, 8)]),
        ],
      ),
      ...(open
        ? [
            h.div(
              [h.Class("workstream-detail")],
              [
                activityBlock(h, activity),
                sessions.length === 0
                  ? h.p(
                      [h.Class("empty muted")],
                      ["No live session matched. Label a terminal with workstream=" + ws.id + "."],
                    )
                  : h.div(
                      [h.Class("session-list")],
                      sessions.map((session) => sessionRow(h, session)),
                    ),
              ],
            ),
          ]
        : []),
    ],
  )

const repoSection = (
  h: HtmlBuilder<Message>,
  repo: string,
  workstreams: ReadonlyArray<typeof Workstream.Type>,
  activities: ReadonlyArray<typeof Activity.Type>,
  sessions: ReadonlyArray<typeof Session.Type>,
  closed: boolean,
  openWorkstreams: ReadonlyArray<string>,
) =>
  h.section(
    [h.Class("repo" + (closed ? " closed" : ""))],
    [
      h.h2(
        [h.Class("repo-heading")],
        [
          h.button(
            [
              h.Class("repo-toggle"),
              h.AriaExpanded(!closed),
              h.AriaLabel((closed ? "Show " : "Hide ") + repo + " workstreams"),
              h.OnClick(Message.ToggledRepo({ repo })),
            ],
            [
              h.span([h.Class("repo-name")], [repo]),
              h.span(
                [h.Class("muted")],
                [workstreams.length + (workstreams.length === 1 ? " workstream" : " workstreams")],
              ),
              h.span([h.Class("chevron"), h.AriaHidden(true)], [closed ? "▸" : "▾"]),
            ],
          ),
        ],
      ),
      ...(closed
        ? []
        : phaseOrder.flatMap((phase) => {
            const inPhase = workstreams.filter((ws) => ws.phase === phase)
            if (inPhase.length === 0) return []
            return [
              h.div(
                [h.Class("lane")],
                [
                  h.h3(
                    [h.Class("lane-title")],
                    [phaseLabel(phase), h.span([h.Class("count")], [String(inPhase.length)])],
                  ),
                  ...inPhase.map((ws) =>
                    workstreamCard(
                      h,
                      ws,
                      activities.find((activity) => activity.workstream === ws.id),
                      sessions.filter((session) => session.workstream === ws.id),
                      openWorkstreams.includes(ws.id),
                    ),
                  ),
                ],
              ),
            ]
          })),
    ],
  )

const stateMachine = (
  h: HtmlBuilder<Message>,
  workstreams: ReadonlyArray<typeof Workstream.Type>,
) =>
  h.section(
    [h.Class("state-machine")],
    [
      h.h2([], ["State machine"]),
      h.ol(
        [h.Class("states")],
        phaseOrder.map((phase) =>
          h.li(
            [h.Class("state " + phase)],
            [
              h.div(
                [h.Class("state-head")],
                [
                  h.span([h.Class("state-name")], [phaseLabel(phase)]),
                  h.span(
                    [h.Class("state-count")],
                    [String(workstreams.filter((ws) => ws.phase === phase).length)],
                  ),
                ],
              ),
              h.p([h.Class("state-detail")], [phaseDetail(phase)]),
            ],
          ),
        ),
      ),
      h.p(
        [h.Class("muted")],
        ["reconcile → build → land; blocked and done are exits. Counts are current workstreams."],
      ),
    ],
  )

const card = (h: HtmlBuilder<Message>, title: string, children: ReadonlyArray<Html>) =>
  h.div([h.Class("card")], [h.h2([], [title]), ...children])

const deskRow = (h: HtmlBuilder<Message>, item: typeof Desk.Type) =>
  h.div(
    [h.Class("row")],
    [
      h.span([h.Class("id")], [item.id]),
      h.span([h.Class("row-title")], [item.title]),
      h.a(
        [
          h.Href("#" + item.workstream),
          h.OnClick(Message.OpenedWorkstream({ id: item.workstream })),
        ],
        [item.workstream],
      ),
    ],
  )

const reportRow = (h: HtmlBuilder<Message>, report: typeof Report.Type) =>
  h.div(
    [h.Class("report")],
    [
      h.div(
        [h.Class("report-head")],
        [
          h.span([h.Class("id")], [report.kind]),
          h.a(
            [
              h.Href("#" + report.workstream),
              h.OnClick(Message.OpenedWorkstream({ id: report.workstream })),
            ],
            [report.workstream],
          ),
          report.blocked ? h.span([h.Class("blocked-flag")], ["blocked"]) : h.span([], []),
        ],
      ),
      h.p([h.Class("report-body")], [report.actual]),
    ],
  )

/** Render the factory state; every field comes from /presence. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const presence = model.presence
  return {
    title: "Software factory",
    body: h.div(
      [h.Class("shell")],
      [
        h.header(
          [h.Class("header")],
          [
            h.div(
              [],
              [
                h.h1([], ["Software factory"]),
                presence === null
                  ? h.span([h.Class("muted")], ["waiting for presence"])
                  : h.span(
                      [h.Class("muted")],
                      [
                        String(presence.factory.workstreams.length) +
                          " workstreams across " +
                          String(new Set(presence.factory.workstreams.map(repoName)).size) +
                          " repos",
                      ],
                    ),
              ],
            ),
            h.button(
              [h.Class("refresh"), h.OnClick(Message.ClickedRefresh())],
              [model.loading ? "Refreshing…" : "Refresh"],
            ),
          ],
        ),
        ...(model.error === null
          ? []
          : [h.p([h.Class("error")], ["Could not read /presence: " + model.error])]),
        ...(model.notice === null
          ? []
          : [h.p([h.Class("notice"), h.AriaLive("polite")], [model.notice])]),
        ...(presence === null
          ? []
          : [
              stateMachine(h, presence.factory.workstreams),
              ...Array.from(new Set(presence.factory.workstreams.map(repoName))).map((repo) =>
                repoSection(
                  h,
                  repo,
                  presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
                  presence.factory.activity,
                  [...presence.sessions.herdr.sessions, ...presence.sessions.rex.sessions],
                  model.closedRepos.includes(repo),
                  model.openWorkstreams,
                ),
              ),
              card(
                h,
                "Desk",
                presence.factory.desk.map((item) => deskRow(h, item)),
              ),
              card(
                h,
                "Reports",
                presence.factory.reports.map((item) => reportRow(h, item)),
              ),
              ...(() => {
                const allSessions = [
                  ...presence.sessions.herdr.sessions,
                  ...presence.sessions.rex.sessions,
                ]
                const unmatched = allSessions.filter((session) => session.workstream === undefined)
                return unmatched.length === 0
                  ? []
                  : [
                      card(
                        h,
                        "Sessions not joined to a workstream",
                        unmatched.map((s) => sessionRow(h, s)),
                      ),
                    ]
              })(),
            ]),
      ],
    ),
  }
}
