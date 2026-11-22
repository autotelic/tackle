import { Effect, Option, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
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
  body: Schema.String,
  choices: Schema.Array(Schema.String),
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
  budget: Schema.Struct({ used: Schema.Finite, passesPerPhase: Schema.Finite }),
  phase: Schema.String,
  state: Schema.Literals(["working", "queued", "blocked", "idle", "done"]),
  blockedBy: Schema.Array(Schema.String),
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
  Ticked: {},
  ClickedOpen: { source: SessionSource, address: Schema.String },
  Opened: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
  ClickedAnswer: { item: Schema.String, choice: Schema.String },
  Answered: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
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
    ClickedAnswer: ({ item, choice }) => ({
      model,
      commands: [AnswerDesk({ item, choice })],
    }),
    Answered: ({ ok, error }) => ({
      model: {
        ...model,
        notice: ok ? "Decision recorded" : "Could not record: " + (error ?? "unknown error"),
      },
      commands: ok ? [FetchPresence()] : [],
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

export const AnswerDesk = Command.define("AnswerDesk", {
  args: { item: Schema.String, choice: Schema.String },
  messages: [Message.Answered],
  execute: ({ item, choice }: { readonly item: string; readonly choice: string }) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch("/desk/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ item, choice, by: "web" }),
        })
        if (!response.ok) return Promise.reject((await response.text()) || "answer failed")
        return true
      },
      catch: (cause) => String(cause),
    }).pipe(
      Effect.match({
        onFailure: (error) => Message.Answered({ ok: false, error }),
        onSuccess: () => Message.Answered({ ok: true, error: null }),
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
const repoName = (ws: typeof Workstream.Type): string => ws.repo ?? "unknown repository"

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
        ],
      ),
    ],
  )

const stateName = (state: typeof Activity.Type.state): string => {
  switch (state) {
    case "working":
      return "Working"
    case "queued":
      return "Queued"
    case "blocked":
      return "Blocked"
    case "idle":
      return "Idle"
    case "done":
      return "Done"
  }
}

const formatDuration = (minutes: number | null): string => {
  if (minutes === null) return "unknown"
  if (minutes < 1) return "under a minute"
  if (minutes < 60) return minutes + "m"
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + "h " + (minutes % 60) + "m"
  return Math.floor(hours / 24) + "d"
}

const firstClause = (text: string): string => {
  const sentence = text.split(/(?<=[.!?])\s/u)[0] ?? text
  return sentence.length > 96 ? sentence.slice(0, 93) + "…" : sentence
}

const queueTitle = (event: {
  readonly kind: string
  readonly summary?: string | undefined
}): string => {
  if (event.kind === "report-backlog") return "Triage the factory report backlog"
  if (event.kind === "report") {
    if (event.summary?.toLowerCase().includes("gate field") === true)
      return "Add gate data to /presence"
    return "A report needs a pass: " + firstClause(event.summary ?? "")
  }
  return event.kind.split("-").join(" ")
}

const activityBlock = (h: HtmlBuilder<Message>, activity: typeof Activity.Type | undefined) => {
  if (activity === undefined) return h.span([], [])
  const pass = activity.lastPass
  const running = activity.state === "working"
  const waiting = activity.pending.length
  const capped = activity.blockedBy.some((reason) => reason.startsWith("budget:"))
  const age = formatDuration(activity.ageMinutes)
  const last =
    pass === null
      ? ""
      : running
        ? "Pass #" + pass.pass + " running"
        : "Pass #" + pass.pass + " · " + age + " ago"
  const gate =
    pass?.quality === undefined
      ? ""
      : pass.quality.after.errors === 0
        ? "Gate green"
        : "Gate red · " + pass.quality.after.errors + " errors"
  if (last === "" && waiting === 0 && gate === "") return h.span([], [])
  return h.div(
    [h.Class("activity" + (capped ? " capped" : "") + (running ? " running" : ""))],
    [
      last === ""
        ? h.span([], [])
        : h.div(
            [h.Class("activity-head")],
            [
              h.span([h.Class("activity-last")], [last]),
              capped
                ? h.span(
                    [h.Class("stale-flag")],
                    [activity.budget.used + "/" + activity.budget.passesPerPhase + " passes"],
                  )
                : h.span([], []),
            ],
          ),
      ...(waiting === 0
        ? []
        : [
            h.div(
              [h.Class("activity-queue")],
              [
                h.div([h.Class("queue-count")], [waiting + " waiting"]),
                ...activity.pending.map((event) =>
                  h.details(
                    [h.Class("queue-item")],
                    [
                      h.summary([], [queueTitle(event)]),
                      h.p([h.Class("queue-detail")], [event.summary ?? "No further detail."]),
                    ],
                  ),
                ),
              ],
            ),
          ]),
      gate === "" ? h.span([], []) : h.div([h.Class("activity-meta")], [h.span([], [gate])]),
    ],
  )
}

const workstreamCard = (
  h: HtmlBuilder<Message>,
  ws: typeof Workstream.Type,
  activity: typeof Activity.Type | undefined,
  sessions: ReadonlyArray<typeof Session.Type>,
) =>
  h.article(
    [h.Class("workstream"), h.Id(ws.id)],
    [
      h.div(
        [h.Class("workstream-head")],
        [
          h.div([], [h.h3([], [ws.label]), h.div([h.Class("mono muted")], [ws.id])]),
          h.div(
            [h.Class("pills")],
            [
              activity === undefined
                ? h.span([], [])
                : h.span([h.Class("state-pill " + activity.state)], [stateName(activity.state)]),
            ],
          ),
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
      activityBlock(h, activity),
      sessions.length === 0
        ? h.span([], [])
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
  activities: ReadonlyArray<typeof Activity.Type>,
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
                  activities.find((activity) => activity.workstream === ws.id),
                  sessions.filter((session) => session.workstream === ws.id),
                ),
              ),
            ],
          ),
        ]
      }),
    ],
  )

const card = (
  h: HtmlBuilder<Message>,
  input: {
    readonly title: string
    readonly children: ReadonlyArray<Html>
    readonly id?: string
  },
) =>
  h.div(
    [h.Class("card"), ...(input.id === undefined ? [] : [h.Id(input.id)])],
    [h.h2([], [input.title]), ...input.children],
  )

const deskRow = (h: HtmlBuilder<Message>, item: typeof Desk.Type) =>
  h.div(
    [h.Class("desk-item"), h.Id(item.id)],
    [
      h.div(
        [h.Class("desk-head")],
        [
          h.span([h.Class("desk-title")], [item.title]),
          h.a([h.Href("#" + item.workstream)], [item.workstream]),
        ],
      ),
      h.p([h.Class("desk-body")], [item.body]),
      h.div(
        [h.Class("desk-choices")],
        item.choices.map((choice) =>
          h.button([h.OnClick(Message.ClickedAnswer({ item: item.id, choice }))], [choice]),
        ),
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
                  : (() => {
                      const count = presence.factory.workstreams.length
                      const repos = new Set(presence.factory.workstreams.map(repoName)).size
                      const waiting = presence.factory.activity.reduce(
                        (total, activity) => total + activity.pending.length,
                        0,
                      )
                      return h.span(
                        [h.Class("muted")],
                        [
                          count +
                            (count === 1 ? " workstream" : " workstreams") +
                            " · " +
                            repos +
                            (repos === 1 ? " repo" : " repos") +
                            (waiting === 0 ? "" : " · " + waiting + " waiting"),
                        ],
                      )
                    })(),
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
              ...Array.from(new Set(presence.factory.workstreams.map(repoName))).map((repo) =>
                repoSection(
                  h,
                  repo,
                  presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
                  presence.factory.activity,
                  [...presence.sessions.herdr.sessions, ...presence.sessions.rex.sessions],
                ),
              ),
              ...(presence.factory.desk.length === 0
                ? []
                : [
                    card(h, {
                      title: "Needs you",
                      children: presence.factory.desk.map((item) => deskRow(h, item)),
                      id: "desk",
                    }),
                  ]),
              ...(presence.factory.reports.length === 0
                ? []
                : [
                    h.details(
                      [h.Class("card reports-card")],
                      [
                        h.summary([], ["Reports (" + presence.factory.reports.length + ")"]),
                        ...presence.factory.reports.map((item) => reportRow(h, item)),
                      ],
                    ),
                  ]),
            ]),
      ],
    ),
  }
}
