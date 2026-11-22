import { Effect, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import {
  Presence,
  SessionSource,
  type Desk,
  type Report,
  type Session,
  type Workstream,
  sessionsOf,
} from "./presence.ts"
import {
  GATE_MISSING,
  PR_STATE_MISSING,
  UNFILED,
  checkpointAge,
  groupByRepo,
  isUnobserved,
  observationLabel,
  repoLine,
  repoOf,
  type RepoPanel,
} from "./repos.ts"

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
const sessionCommand = (session: Session): string =>
  session.source === "herdr" ? "hc attach " + session.address : "rex block focus " + session.address

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

/** The commit, aged from the board's observation instant; no checkpoint is said, not zeroed. */
const checkpointCell = (h: HtmlBuilder<Message>, ws: Workstream, observedAt: string) =>
  ws.checkpoint === null
    ? h.span([h.Class("mono")], ["no checkpoint yet"])
    : h.span(
        [h.Class("mono")],
        [
          "checkpoint " +
            ws.checkpoint.sha.slice(0, 8) +
            checkpointAge({ at: ws.checkpoint.at, observedAt }),
        ],
      )

/** Freshness is three-valued; `unobserved` is the one that must not read as `stale`. */
const observationCell = (
  h: HtmlBuilder<Message>,
  ws: Workstream,
  observedAt: string,
  live: boolean,
) =>
  h.span(
    [h.Class("freshness " + (live ? "live" : isUnobserved(ws) ? "unobserved" : "observed"))],
    [observationLabel({ workstream: ws, observedAt, live })],
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
          h.div([], [h.h3([], [ws.label]), h.div([h.Class("mono muted")], [ws.id])]),
          h.span([h.Class("phase-pill " + ws.phase)], [phaseLabel(ws.phase) ?? ws.phase]),
        ],
      ),
      h.div(
        [h.Class("workstream-meta")],
        [
          repoOf(ws) === UNFILED
            ? h.span([h.Class("muted")], ["no repo in /presence"])
            : h.a(
                [
                  h.Href("https://github.com/" + repoOf(ws)),
                  h.Target("_blank"),
                  h.Rel("noreferrer"),
                ],
                [repoOf(ws)],
              ),
          h.span([], [ws.branch ?? "no branch"]),
          ws.pr === undefined
            ? h.span([], ["trunk"])
            : repoOf(ws) === UNFILED
              ? // A PR number with no repo cannot be linked; it is still a fact worth showing.
                h.span([], ["PR #" + ws.pr])
              : h.a(
                  [
                    h.Href("https://github.com/" + repoOf(ws) + "/pull/" + ws.pr),
                    h.Target("_blank"),
                    h.Rel("noreferrer"),
                  ],
                  ["PR #" + ws.pr],
                ),
          checkpointCell(h, ws, observedAt),
          observationCell(h, ws, observedAt, sessions.length > 0),
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

/**
 * One repo panel: a sentence header, the gate slot it cannot fill, then the lanes.
 *
 * The header is a sentence because the operator reads it in one glance on a phone, and
 * because a table of counts hides which counts are missing.
 */
const repoSection = (
  h: HtmlBuilder<Message>,
  panel: RepoPanel,
  sessions: ReadonlyArray<Session>,
  observedAt: string,
) =>
  h.section(
    [h.Class("repo"), h.Id("repo-" + panel.repo.replaceAll("/", "-"))],
    [
      h.div(
        [h.Class("repo-head")],
        [h.h2([], [panel.repo]), h.p([h.Class("repo-line")], [repoLine({ panel, observedAt })])],
      ),
      h.p([h.Class("repo-missing")], [GATE_MISSING]),
      ...phaseOrder.flatMap((phase) => {
        const inPhase = panel.workstreams.filter((ws) => ws.phase === phase)
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
                  observedAt,
                ),
              ),
            ],
          ),
        ]
      }),
    ],
  )

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
      h.a([h.Href("#" + item.workstream)], [item.workstream]),
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
  // Ages are measured from the board's observation instant, never from this browser's
  // clock: two people looking at the same document must read the same ages.
  const observedAt = presence?.observedAt ?? ""
  const panels =
    presence === null ? [] : groupByRepo(presence.factory.workstreams, sessionsOf(presence))
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
                          " workstreams in " +
                          String(panels.length) +
                          (panels.length === 1 ? " panel" : " panels"),
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
              ...panels.map((panel) => repoSection(h, panel, sessionsOf(presence), observedAt)),
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
              card(h, "Not in /presence", [
                h.p([h.Class("missing")], [GATE_MISSING]),
                h.p([h.Class("missing")], [PR_STATE_MISSING]),
                h.p(
                  [h.Class("muted")],
                  [
                    "Nothing on this page is inferred: a panel shows the counts the document " +
                      "carries and names the ones it does not.",
                  ],
                ),
              ]),
              ...(() => {
                const unmatched = sessionsOf(presence).filter(
                  (session) => session.workstream === undefined,
                )
                return unmatched.length === 0
                  ? []
                  : [
                      card(
                        h,
                        "Sessions not joined to a workstream",
                        unmatched.map((session) => sessionRow(h, session)),
                      ),
                    ]
              })(),
            ]),
      ],
    ),
  }
}
