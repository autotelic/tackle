import { Effect, Option, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { copyText } from "foldkit-primitives/dom"
import { ticks } from "foldkit-primitives/time"
import {
  Presence,
  SessionSource,
  sessionsOf,
  type Desk,
  type Report,
  type Session,
  type Workstream,
} from "./presence.ts"
import { workstreamOfPath, workstreamPath } from "./route.ts"
import {
  blockedByLabel,
  budgetLabel,
  checkpointLabel,
  closedFlags,
  freshnessLabel,
  observedLabel,
  sessionCommand,
  sourceAgeLabel,
  sourceFreshnessLabel,
} from "./status.ts"

export const Model = Schema.Struct({
  presence: Schema.NullOr(Presence),
  error: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  /** The path selects a panel; it is a filter over the one presence document. */
  route: Schema.optional(Schema.String),
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

const initial =
  (route: string): Runtime.ApplicationInit<Model, Message> =>
  () => ({
    model: { presence: null, error: null, loading: true, notice: null, route },
    commands: [FetchPresence()],
  })

/** Start on the overview with an empty model and one presence fetch. */
export const init: Runtime.ApplicationInit<Model, Message> = initial("")

/**
 * Start on the panel a shared path names.
 *
 * @param route - the browser path, read once at the I/O boundary in `entry.ts`.
 * @returns the application init for that path.
 */
export const initAt = (route: string): Runtime.ApplicationInit<Model, Message> => initial(route)

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
const repoName = (ws: Workstream): string => ws.repo ?? "unknown repository"

const repoHref = (ws: Workstream): Option.Option<string> =>
  ws.repo === undefined ? Option.none() : Option.some("https://github.com/" + ws.repo)

const prHref = (ws: Workstream): Option.Option<string> =>
  ws.repo === undefined || ws.pr === undefined
    ? Option.none()
    : Option.some("https://github.com/" + ws.repo + "/pull/" + ws.pr)

/**
 * The Linear project link. `/presence` carries the project id (and, when a source read
 * supplied one, the project URL); the generic project path is only built from the id,
 * never guessed from a label.
 */
const projectHref = (ws: Workstream): Option.Option<string> =>
  ws.projectUrl === undefined
    ? ws.linearProjectId === undefined
      ? Option.none()
      : Option.some("https://linear.app/project/" + encodeURIComponent(ws.linearProjectId))
    : Option.some(ws.projectUrl)

const external = (input: {
  readonly h: HtmlBuilder<Message>
  readonly href: string
  readonly text: string
}) =>
  input.h.a(
    [input.h.Href(input.href), input.h.Target("_blank"), input.h.Rel("noreferrer")],
    [input.text],
  )

const sessionRow = (h: HtmlBuilder<Message>, session: Session) =>
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

const sessionList = (h: HtmlBuilder<Message>, sessions: ReadonlyArray<Session>, empty: string) =>
  sessions.length === 0
    ? h.p([h.Class("empty muted")], [empty])
    : h.div(
        [h.Class("session-list")],
        sessions.map((session) => sessionRow(h, session)),
      )

/** A labelled value on the panel; the label is the JSON path a reader can check. */
const panelRow = (input: {
  readonly h: HtmlBuilder<Message>
  readonly label: string
  readonly value: string
}) =>
  input.h.div(
    [input.h.Class("panel-row")],
    [
      input.h.span([input.h.Class("panel-label")], [input.label]),
      input.h.span([input.h.Class("panel-value")], [input.value]),
    ],
  )

const workstreamCard = (
  h: HtmlBuilder<Message>,
  ws: Workstream,
  sessions: ReadonlyArray<Session>,
  observedAt: string,
) =>
  h.article(
    [h.Class("workstream"), h.Id(ws.id)],
    [
      h.div(
        [h.Class("workstream-head")],
        [
          h.div(
            [],
            [
              h.h3([], [h.a([h.Href(workstreamPath(ws.id))], [ws.label])]),
              h.div([h.Class("mono muted")], [ws.id]),
            ],
          ),
          h.span([h.Class("phase-pill " + ws.phase)], [phaseLabel(ws.phase)]),
        ],
      ),
      h.div(
        [h.Class("workstream-meta")],
        [
          Option.match(repoHref(ws), {
            onNone: () => h.span([], ["no repo in /presence"]),
            onSome: (href) => external({ h, href, text: repoName(ws) }),
          }),
          h.span([], [ws.branch ?? "no branch"]),
          Option.match(prHref(ws), {
            onNone: () => h.span([], [ws.delivery === "trunk" ? "delivery trunk" : "no PR"]),
            onSome: (href) => external({ h, href, text: "PR #" + ws.pr }),
          }),
          h.span([h.Class("mono")], [checkpointLabel({ checkpoint: ws.checkpoint, observedAt })]),
          h.span([], [budgetLabel(ws.budget)]),
          h.span([], ["freshness " + freshnessLabel(ws.freshness)]),
        ],
      ),
      sessionList(
        h,
        sessions,
        "No live session matched. Label a terminal with workstream=" + ws.id + ".",
      ),
    ],
  )

const repoSection = (input: {
  readonly h: HtmlBuilder<Message>
  readonly repo: string
  readonly workstreams: ReadonlyArray<Workstream>
  readonly sessions: ReadonlyArray<Session>
  readonly observedAt: string
}) => {
  const h = input.h
  return h.section(
    [h.Class("repo")],
    [
      h.div(
        [h.Class("repo-head")],
        [
          h.h2([], [input.repo]),
          h.span(
            [h.Class("muted")],
            [
              input.workstreams.length +
                (input.workstreams.length === 1 ? " workstream" : " workstreams"),
            ],
          ),
        ],
      ),
      ...phaseOrder.flatMap((phase) => {
        const inPhase = input.workstreams.filter((ws) => ws.phase === phase)
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
                  input.sessions.filter((session) => session.workstream === ws.id),
                  input.observedAt,
                ),
              ),
            ],
          ),
        ]
      }),
    ],
  )
}

const stateMachine = (h: HtmlBuilder<Message>, workstreams: ReadonlyArray<Workstream>) =>
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

const deskRow = (h: HtmlBuilder<Message>, item: Desk) =>
  h.div(
    [h.Class("row")],
    [
      h.span([h.Class("id")], [item.id]),
      h.span([], [item.title]),
      h.a([h.Href(workstreamPath(item.workstream))], [item.workstream]),
    ],
  )

const reportRow = (h: HtmlBuilder<Message>, report: Report) =>
  h.div(
    [h.Class("report")],
    [
      h.div(
        [h.Class("report-head")],
        [
          h.span([h.Class("id")], [report.kind]),
          h.a([h.Href(workstreamPath(report.workstream))], [report.workstream]),
          report.blocked ? h.span([h.Class("blocked-flag")], ["blocked"]) : h.span([], []),
        ],
      ),
      h.p([h.Class("report-body")], [report.actual]),
    ],
  )

/**
 * One workstream's panel: the detail a person needs before deciding whether to care.
 * Every value is a field on the workstream; a missing field says so rather than zeroing.
 */
const workstreamPanel = (
  h: HtmlBuilder<Message>,
  ws: Workstream,
  sessions: ReadonlyArray<Session>,
  desk: ReadonlyArray<Desk>,
  reports: ReadonlyArray<Report>,
  observedAt: string,
) => {
  const flags = closedFlags(ws)
  const project = projectHref(ws)
  return h.article(
    [h.Class("panel"), h.Id("workstream-" + ws.id)],
    [
      h.a([h.Class("back"), h.Href("/factory")], ["← All workstreams"]),
      h.div(
        [h.Class("panel-head")],
        [
          h.div([], [h.h1([], [ws.label]), h.div([h.Class("mono muted")], [ws.id])]),
          h.span([h.Class("phase-pill " + ws.phase)], [phaseLabel(ws.phase)]),
        ],
      ),
      h.div([h.Class("panel-flags")], [flags.line]),
      flags.warning === null
        ? h.p([h.Class("muted")], ["the three closed flags agree"])
        : h.p([h.Class("warning")], [flags.warning]),
      h.div(
        [h.Class("panel-grid")],
        [
          panelRow({ h, label: "phase", value: ws.phase }),
          panelRow({
            h,
            label: "checkpoint",
            value: checkpointLabel({ checkpoint: ws.checkpoint, observedAt }),
          }),
          panelRow({ h, label: "freshness", value: freshnessLabel(ws.freshness) }),
          panelRow({ h, label: "sources", value: sourceFreshnessLabel(ws) }),
          panelRow({
            h,
            label: "observed",
            value: observedLabel({ observed: ws.observed, observedAt }),
          }),
          panelRow({
            h,
            label: "github age",
            value: sourceAgeLabel({ at: ws.observed?.github, observedAt }),
          }),
          panelRow({
            h,
            label: "linear age",
            value: sourceAgeLabel({ at: ws.observed?.linear, observedAt }),
          }),
          panelRow({
            h,
            label: "reports age",
            value: sourceAgeLabel({ at: ws.observed?.reports, observedAt }),
          }),
          panelRow({ h, label: "budget", value: budgetLabel(ws.budget) }),
          panelRow({ h, label: "blockedBy", value: blockedByLabel(ws.blockedBy) }),
        ],
      ),
      h.div(
        [h.Class("panel-links")],
        [
          h.span([h.Class("panel-label")], ["links"]),
          Option.match(repoHref(ws), {
            onNone: () => h.span([], ["repo: not in /presence"]),
            onSome: (href) => external({ h, href, text: "repo " + repoName(ws) }),
          }),
          Option.match(prHref(ws), {
            onNone: () =>
              h.span(
                [],
                ["PR: " + (ws.delivery === "trunk" ? "delivery trunk" : "not in /presence")],
              ),
            onSome: (href) => external({ h, href, text: "PR " + ws.pr }),
          }),
          Option.match(project, {
            onNone: () => h.span([], ["Linear project: no project id in /presence"]),
            onSome: (href) => external({ h, href, text: "Linear " + ws.project }),
          }),
          h.span([h.Class("mono")], [ws.branch ?? "no branch"]),
        ],
      ),
      h.section(
        [h.Class("panel-section")],
        [
          h.h2([], ["Sessions"]),
          sessionList(
            h,
            sessions,
            "No live session matched. Label a terminal with workstream=" + ws.id + ".",
          ),
        ],
      ),
      ...(desk.length === 0
        ? []
        : [
            h.section(
              [h.Class("panel-section")],
              [h.h2([], ["Desk"]), ...desk.map((item) => deskRow(h, item))],
            ),
          ]),
      ...(reports.length === 0
        ? []
        : [
            h.section(
              [h.Class("panel-section")],
              [h.h2([], ["Reports"]), ...reports.map((item) => reportRow(h, item))],
            ),
          ]),
    ],
  )
}

const missingPanel = (h: HtmlBuilder<Message>, id: string) =>
  h.article(
    [h.Class("panel")],
    [
      h.a([h.Class("back"), h.Href("/factory")], ["← All workstreams"]),
      h.h1([], ["Workstream not in /presence"]),
      h.p(
        [h.Class("muted")],
        ["The path names " + id + "; the board served no workstream with that id."],
      ),
    ],
  )

/** The overview: one section per repository, then the desk, reports and unmatched sessions. */
const overview = (h: HtmlBuilder<Message>, presence: Presence): ReadonlyArray<Html> => {
  const allSessions = sessionsOf(presence)
  const repos = Array.from(new Set(presence.factory.workstreams.map(repoName)))
  const unmatched = allSessions.filter((session) => session.workstream === undefined)
  return [
    stateMachine(h, presence.factory.workstreams),
    ...repos.map((repo) =>
      repoSection({
        h,
        repo,
        workstreams: presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
        sessions: allSessions,
        observedAt: presence.observedAt,
      }),
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
    ...(unmatched.length === 0
      ? []
      : [
          card(
            h,
            "Sessions not joined to a workstream",
            unmatched.map((session) => sessionRow(h, session)),
          ),
        ]),
  ]
}

/** Render the factory state; every field comes from /presence. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const presence = model.presence
  const selected = workstreamOfPath(model.route ?? "")
  const selectedId = selected._tag === "Panel" ? selected.id : undefined
  const workstream =
    selectedId === undefined || presence === null
      ? undefined
      : presence.factory.workstreams.find((candidate) => candidate.id === selectedId)
  const title =
    workstream === undefined ? "Software factory" : workstream.label + " · software factory"
  return {
    title,
    body: h.div(
      [h.Class("shell")],
      [
        h.header(
          [h.Class("header")],
          [
            h.div(
              [],
              [
                h.h1([], [workstream === undefined ? "Software factory" : workstream.label]),
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
          : selected._tag === "None"
            ? overview(h, presence)
            : workstream === undefined
              ? [missingPanel(h, selected.id)]
              : [
                  workstreamPanel(
                    h,
                    workstream,
                    sessionsOf(presence).filter((session) => session.workstream === workstream.id),
                    presence.factory.desk.filter((item) => item.workstream === workstream.id),
                    presence.factory.reports.filter((item) => item.workstream === workstream.id),
                    presence.observedAt,
                  ),
                ]),
      ],
    ),
  }
}
