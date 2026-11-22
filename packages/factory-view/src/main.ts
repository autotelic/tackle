import { Effect, Option, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { copyText } from "foldkit-primitives/dom"
import { ticks } from "foldkit-primitives/time"

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
    desk: Schema.Array(Desk),
    reports: Schema.Array(Report),
  }),
  sessions: Schema.Struct({ herdr: SessionSourceView, rex: SessionSourceView }),
})
type Presence = typeof Presence.Type

export const Model = Schema.Struct({
  presence: Schema.NullOr(Presence),
  error: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedRefresh: {},
  Settled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
  ClickedCopy: { command: Schema.String },
  Copied: {},
  CopyFailed: { message: Schema.String },
  Ticked: {},
  ClickedOpen: { source: SessionSource, address: Schema.String },
  Opened: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
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
        : { model: { ...model, loading: true }, commands: [FetchPresence()] },
    Settled: ({ value, error }) => {
      if (error !== null) return { model: { ...model, presence: null, error, loading: false } }
      const decoded = Schema.decodeUnknownResult(Presence)(value)
      return Result.isSuccess(decoded)
        ? { model: { ...model, presence: decoded.success, error: null, loading: false } }
        : { model: { ...model, presence: null, error: String(decoded.failure), loading: false } }
    },
    ClickedCopy: ({ command }) => ({
      model,
      commands: [
        Command.mapMessage(copyText(command), (result) =>
          result._tag === "Copied"
            ? Message.Copied()
            : Message.CopyFailed({ message: result.message }),
        ),
      ],
    }),
    Copied: () => ({ model, notice: "Copied the open command" }),
    CopyFailed: ({ message }) => ({ model, notice: "Could not copy: " + message }),
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
  model: { presence: null, error: null, loading: true, notice: null },
  commands: [FetchPresence()],
})

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

const sessionRow = (h: HtmlBuilder<Message>, session: typeof Session.Type) =>
  h.div(
    [h.Class("session")],
    [
      h.div(
        [h.Class("session-main")],
        [
          h.span([h.Class("session-id")], [session.source + " " + session.address]),
          h.span([h.Class("muted")], [session.where ?? session.agent ?? ""]),
        ],
      ),
      h.div(
        [h.Class("session-actions")],
        [
          h.button(
            [h.OnClick(Message.ClickedOpen({ source: session.source, address: session.address }))],
            ["Open"],
          ),
          h.button(
            [h.OnClick(Message.ClickedCopy({ command: sessionCommand(session) }))],
            ["Copy"],
          ),
        ],
      ),
    ],
  )

const workstreamCard = (
  h: HtmlBuilder<Message>,
  ws: typeof Workstream.Type,
  sessions: ReadonlyArray<typeof Session.Type>,
) =>
  h.article(
    [h.Class("workstream"), h.Id(ws.id)],
    [
      h.div(
        [h.Class("workstream-head")],
        [
          h.div([], [h.h3([], [ws.label]), h.div([h.Class("mono muted")], [ws.id])]),
          h.span([h.Class("phase-pill " + ws.phase)], [phaseLabel(ws.phase) ?? ws.phase]),
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
  )

const repoSection = (
  h: HtmlBuilder<Message>,
  repo: string,
  workstreams: ReadonlyArray<typeof Workstream.Type>,
  sessions: ReadonlyArray<typeof Session.Type>,
) =>
  h.section(
    [h.Class("repo")],
    [
      h.div(
        [h.Class("repo-head")],
        [
          h.h2([], [repo]),
          h.span(
            [h.Class("muted")],
            [workstreams.length + (workstreams.length === 1 ? " workstream" : " workstreams")],
          ),
        ],
      ),
      ...phaseOrder.flatMap((phase) => {
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
                  sessions.filter((session) => session.workstream === ws.id),
                ),
              ),
            ],
          ),
        ]
      }),
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
      h.span([], [item.title]),
      h.a([h.Href("#" + item.workstream)], [item.workstream]),
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
          h.a([h.Href("#" + report.workstream)], [report.workstream]),
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
              [h.OnClick(Message.ClickedRefresh())],
              [model.loading ? "Refreshing…" : "Refresh"],
            ),
          ],
        ),
        ...(model.error === null
          ? []
          : [h.p([h.Class("error")], ["Could not read /presence: " + model.error])]),
        ...(model.notice === null ? [] : [h.p([h.Class("notice")], [model.notice])]),
        ...(presence === null
          ? []
          : [
              stateMachine(h, presence.factory.workstreams),
              ...Array.from(new Set(presence.factory.workstreams.map(repoName))).map((repo) =>
                repoSection(
                  h,
                  repo,
                  presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
                  [...presence.sessions.herdr.sessions, ...presence.sessions.rex.sessions],
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
