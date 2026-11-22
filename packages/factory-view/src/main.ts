import { Effect, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

const Workstream = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  label: Schema.String,
  phase: Schema.String,
  path: Schema.String,
  pr: Schema.optional(Schema.Finite),
  delivery: Schema.optional(Schema.String),
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
  ClickedOpen: { source: SessionSource, address: Schema.String },
  Opened: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
})
export type Message = typeof Message.Type

type UpdateReturn = Update.Return<Model, Message>

/** The Foldkit update function: every transition is explicit here. */
export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedRefresh: () => ({ model: { ...model, loading: true }, commands: [FetchPresence()] }),
    Settled: ({ value, error }) => {
      if (error !== null) return { model: { ...model, presence: null, error, loading: false } }
      const decoded = Schema.decodeUnknownResult(Presence)(value)
      return Result.isSuccess(decoded)
        ? { model: { ...model, presence: decoded.success, error: null, loading: false } }
        : { model: { ...model, presence: null, error: String(decoded.failure), loading: false } }
    },
    ClickedCopy: ({ command }) => ({ model, commands: [CopyCommand({ command })] }),
    Copied: () => ({ model, notice: "Copied the open command" }),
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

export const CopyCommand = Command.define("CopyCommand", {
  args: { command: Schema.String },
  messages: [Message.Copied],
  execute: ({ command }: { readonly command: string }) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(command),
      catch: () => undefined,
    }).pipe(Effect.ignore, Effect.as(Message.Copied())),
})

const card = (h: HtmlBuilder<Message>, title: string, children: ReadonlyArray<Html>) =>
  h.div([h.Class("card")], [h.h2([], [title]), ...children])

const workstreamRow = (h: HtmlBuilder<Message>, ws: typeof Workstream.Type) =>
  h.div(
    [h.Class("row")],
    [
      h.span([h.Class("id")], [ws.id]),
      h.span([], [ws.project]),
      h.span([h.Class("phase " + ws.phase)], [ws.phase]),
      h.span([], [ws.pr === undefined ? "trunk" : "PR " + ws.pr]),
      h.span([h.Class("muted")], [ws.checkpoint.sha.slice(0, 8)]),
    ],
  )

const sessionRow = (h: HtmlBuilder<Message>, session: typeof Session.Type) => {
  const command =
    session.source === "herdr"
      ? "hc attach " + session.address
      : "rex block focus " + session.address
  return h.div(
    [h.Class("row")],
    [
      h.span([h.Class("id")], [session.source + " " + session.address]),
      h.span([], [session.agent ?? ""]),
      h.span([h.Class("muted")], [session.where ?? ""]),
      h.button(
        [h.OnClick(Message.ClickedOpen({ source: session.source, address: session.address }))],
        ["Open"],
      ),
      h.button([h.OnClick(Message.ClickedCopy({ command }))], ["Copy"]),
    ],
  )
}

/** Render the factory state; every field comes from /presence. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Software factory",
  body: h.div(
    [h.Class("shell")],
    [
      h.header(
        [h.Class("header")],
        [
          h.h1([], ["Software factory"]),
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
      ...(model.presence === null
        ? []
        : [
            card(h, "Workstreams", [
              ...model.presence.factory.workstreams.map((ws) => workstreamRow(h, ws)),
            ]),
            card(h, "Desk", [
              ...model.presence.factory.desk.map((item) =>
                h.div(
                  [h.Class("row")],
                  [
                    h.span([h.Class("id")], [item.id]),
                    h.span([], [item.title]),
                    h.span([h.Class("muted")], [item.workstream]),
                  ],
                ),
              ),
            ]),
            card(h, "Sessions", [
              ...model.presence.sessions.herdr.sessions.map((session) => sessionRow(h, session)),
              ...model.presence.sessions.rex.sessions.map((session) => sessionRow(h, session)),
            ]),
            card(h, "Reports", [
              ...model.presence.factory.reports.map((report) =>
                h.div(
                  [h.Class("report")],
                  [
                    h.span([h.Class("id")], [report.kind + " · " + report.workstream]),
                    h.span([], [report.actual]),
                  ],
                ),
              ),
            ]),
          ]),
    ],
  ),
})
