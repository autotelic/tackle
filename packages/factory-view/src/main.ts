import { Effect, Option, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { copyText } from "foldkit-primitives/dom"
import { ticks } from "foldkit-primitives/time"
import {
  ageAt,
  checkpointLabel,
  freshnessOfInstant,
  observedLabel,
  overallFreshness,
  POLL_STALE_AFTER_MS,
  sourceFreshness,
  workstreamFreshness,
  type Freshness,
} from "./freshness.ts"
import {
  Presence,
  Session,
  SessionSource,
  sessionsOf,
  type Desk,
  type Report,
  type Workstream,
} from "./presence.ts"

export { Presence, type Desk, type Report, type Session, type Workstream }

export const Model = Schema.Struct({
  presence: Schema.NullOr(Presence),
  error: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  /** The browser's instant for the most recent poll attempt. */
  lastPolledAt: Schema.NullOr(Schema.Finite),
  /** The browser's instant for the last poll that decoded. */
  lastSuccessAt: Schema.NullOr(Schema.Finite),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedRefresh: {},
  Settled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String), at: Schema.Finite },
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
    Settled: ({ value, error, at }) => {
      if (error !== null)
        return {
          model: { ...model, presence: null, error, loading: false, lastPolledAt: at },
        }
      const decoded = Schema.decodeUnknownResult(Presence)(value)
      return Result.isSuccess(decoded)
        ? {
            model: {
              ...model,
              presence: decoded.success,
              error: null,
              loading: false,
              lastPolledAt: at,
              lastSuccessAt: at,
            },
          }
        : {
            model: {
              ...model,
              presence: null,
              error: String(decoded.failure),
              loading: false,
              lastPolledAt: at,
            },
          }
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
  model: {
    presence: null,
    error: null,
    loading: true,
    notice: null,
    lastPolledAt: null,
    lastSuccessAt: null,
  },
  commands: [FetchPresence()],
})

export const FetchPresence = Command.define("FetchPresence", {
  messages: [Message.Settled],
  execute: Effect.suspend(() => {
    // oxlint-disable-next-line plumb/no-nondeterministic-core -- the browser's poll instant is this command's boundary input
    const at = Date.now()
    return Effect.tryPromise({
      try: async () => {
        const response = await fetch("/presence")
        if (!response.ok) return Promise.reject("HTTP " + response.status)
        return await response.json()
      },
      catch: (cause) => String(cause),
    }).pipe(
      Effect.match({
        onFailure: (error) => Message.Settled({ value: null, error: String(error), at }),
        onSuccess: (value) => Message.Settled({ value, error: null, at }),
      }),
    )
  }),
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

const freshnessBadge = (h: HtmlBuilder<Message>, freshness: Freshness) =>
  h.span([h.Class("freshness " + freshness), h.DataAttribute("freshness", freshness)], [freshness])

/** A panel's source freshness beside the age of the observation that produced it. */
const panelMeta = (
  h: HtmlBuilder<Message>,
  input: {
    readonly freshness: Freshness
    readonly observedAt: string | null | undefined
    readonly now: number
    readonly note?: string | undefined
  },
) =>
  h.div(
    [h.Class("panel-meta")],
    [
      freshnessBadge(h, input.freshness),
      h.span([h.Class("mono")], [observedLabel({ at: input.observedAt, now: input.now })]),
      ...(input.note === undefined ? [] : [h.span([h.Class("muted")], [input.note])]),
    ],
  )

const sourceChip = (
  h: HtmlBuilder<Message>,
  input: {
    readonly name: string
    readonly freshness: Freshness
    readonly at: string | null | undefined
    readonly now: number
  },
) =>
  h.span(
    [
      h.Class("source " + input.freshness),
      h.DataAttribute("source", input.name),
      h.DataAttribute("freshness", input.freshness),
    ],
    [
      h.span([h.Class("source-name")], [input.name]),
      h.span(
        [h.Class("source-age mono")],
        [ageAt({ at: input.at, now: input.now }) ?? "unobserved"],
      ),
    ],
  )

const sessionCommand = (session: Session): string =>
  session.source === "herdr" ? "hc attach " + session.address : "rex block focus " + session.address

const sessionRow = (
  h: HtmlBuilder<Message>,
  session: Session,
  input: { readonly observedAt: string | null | undefined; readonly now: number },
) =>
  h.div(
    [h.Class("session")],
    [
      h.div(
        [h.Class("session-main")],
        [
          h.span([h.Class("session-id")], [session.source + " " + session.address]),
          h.span([h.Class("muted")], [session.where ?? session.agent ?? ""]),
          h.span(
            [h.Class("muted mono")],
            [observedLabel({ at: input.observedAt, now: input.now })],
          ),
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
  ws: Workstream,
  sessions: ReadonlyArray<Session>,
  input: { readonly observedAt: string | null | undefined; readonly now: number },
) => {
  const sources = sourceFreshness({ cursors: ws.cursors, now: input.now })
  const freshness = workstreamFreshness({ workstream: ws, now: input.now })
  return h.article(
    [h.Class("workstream"), h.Id(ws.id), h.DataAttribute("freshness", freshness)],
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
          h.span(
            [h.Class("mono")],
            [checkpointLabel({ checkpoint: ws.checkpoint, now: input.now })],
          ),
          freshnessBadge(h, freshness),
          h.span(
            [h.Class("mono muted")],
            [observedLabel({ at: input.observedAt, now: input.now })],
          ),
        ],
      ),
      h.div(
        [h.Class("source-freshness")],
        [
          sourceChip(h, {
            name: "github",
            freshness: sources.github,
            at: ws.cursors?.github,
            now: input.now,
          }),
          sourceChip(h, {
            name: "linear",
            freshness: sources.linear,
            at: ws.cursors?.linear,
            now: input.now,
          }),
          sourceChip(h, {
            name: "reports",
            freshness: sources.reports,
            at: ws.cursors?.reports,
            now: input.now,
          }),
        ],
      ),
      sessions.length === 0
        ? h.p(
            [h.Class("empty muted")],
            ["No live session matched. Label a terminal with workstream=" + ws.id + "."],
          )
        : h.div(
            [h.Class("session-list")],
            sessions.map((session) => sessionRow(h, session, input)),
          ),
    ],
  )
}

const repoSection = (
  h: HtmlBuilder<Message>,
  repo: string,
  workstreams: ReadonlyArray<Workstream>,
  sessions: ReadonlyArray<Session>,
  input: { readonly observedAt: string | null | undefined; readonly now: number },
) => {
  const freshness = overallFreshness(
    workstreams.map((ws) => workstreamFreshness({ workstream: ws, now: input.now })),
  )
  const unobserved = workstreams.filter(
    (ws) => workstreamFreshness({ workstream: ws, now: input.now }) === "unobserved",
  ).length
  return h.section(
    [h.Class("repo"), h.DataAttribute("freshness", freshness)],
    [
      h.div(
        [h.Class("repo-head")],
        [
          h.div(
            [],
            [
              h.h2([], [repo]),
              h.span(
                [h.Class("muted")],
                [workstreams.length + (workstreams.length === 1 ? " workstream" : " workstreams")],
              ),
            ],
          ),
          panelMeta(h, {
            freshness,
            observedAt: input.observedAt,
            now: input.now,
            note: unobserved === 0 ? undefined : unobserved + " unobserved",
          }),
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
                  input,
                ),
              ),
            ],
          ),
        ]
      }),
    ],
  )
}

const stateMachine = (
  h: HtmlBuilder<Message>,
  workstreams: ReadonlyArray<Workstream>,
  input: { readonly observedAt: string | null | undefined; readonly now: number },
) => {
  const freshness = overallFreshness(
    workstreams.map((ws) => workstreamFreshness({ workstream: ws, now: input.now })),
  )
  return h.section(
    [h.Class("state-machine"), h.DataAttribute("freshness", freshness)],
    [
      h.div(
        [h.Class("panel-head")],
        [
          h.h2([], ["State machine"]),
          panelMeta(h, {
            freshness,
            observedAt: input.observedAt,
            now: input.now,
          }),
        ],
      ),
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
}

const card = (h: HtmlBuilder<Message>, title: string, meta: Html, children: ReadonlyArray<Html>) =>
  h.div([h.Class("card")], [h.div([h.Class("panel-head")], [h.h2([], [title]), meta]), ...children])

const deskRow = (h: HtmlBuilder<Message>, item: Desk) =>
  h.div(
    [h.Class("row")],
    [
      h.span([h.Class("id")], [item.id]),
      h.span([], [item.title]),
      h.a([h.Href("#" + item.workstream)], [item.workstream]),
    ],
  )

const reportRow = (h: HtmlBuilder<Message>, report: Report, now: number) =>
  h.div(
    [h.Class("report")],
    [
      h.div(
        [h.Class("report-head")],
        [
          h.span([h.Class("id")], [report.kind]),
          h.a([h.Href("#" + report.workstream)], [report.workstream]),
          h.span([h.Class("mono muted")], [ageAt({ at: report.at, now }) ?? "unknown age"]),
          report.blocked ? h.span([h.Class("blocked-flag")], ["blocked"]) : h.span([], []),
        ],
      ),
      h.p([h.Class("report-body")], [report.actual]),
    ],
  )

const ageLabelOf = (input: { readonly at: number; readonly now: number }): string =>
  ageAt({ at: new Date(input.at).toISOString(), now: input.now }) ?? "just now"

const pollStatus = (model: Model, now: number) => {
  const freshness = freshnessOfInstant({
    at: model.lastPolledAt,
    now,
    windowMs: POLL_STALE_AFTER_MS,
  })
  const age = model.lastPolledAt === null ? undefined : ageLabelOf({ at: model.lastPolledAt, now })
  if (model.error !== null)
    return {
      freshness: freshness === "unobserved" ? "unobserved" : "stale",
      label: age === undefined ? "poll failed" : "poll failed " + age,
    }
  return { freshness, label: age === undefined ? "no poll yet" : "polled " + age }
}

/** Render the factory state; every field comes from /presence and the page's own poll. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  // oxlint-disable-next-line plumb/no-nondeterministic-core -- the renderer is the page's boundary: it stamps one poll instant for every age
  const now = Date.now()
  const presence = model.presence
  const poll = pollStatus(model, now)
  const observedAt = presence?.observedAt ?? undefined
  const workstreams = presence?.factory.workstreams ?? []
  const freshness =
    presence === null
      ? "unobserved"
      : overallFreshness(workstreams.map((ws) => workstreamFreshness({ workstream: ws, now })))
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
            h.div(
              [h.Class("header-status")],
              [
                h.div(
                  [
                    h.Class("poll-status " + poll.freshness),
                    h.DataAttribute("poll", poll.freshness),
                  ],
                  [
                    h.span([h.Class("mono")], [poll.label]),
                    h.span([h.Class("muted")], ["· page " + freshness]),
                  ],
                ),
                h.button(
                  [h.OnClick(Message.ClickedRefresh())],
                  [model.loading ? "Refreshing…" : "Refresh"],
                ),
              ],
            ),
          ],
        ),
        ...(model.error === null
          ? []
          : [
              h.p(
                [h.Class("error feed-lost"), h.Role("alert"), h.DataAttribute("feed", "lost")],
                [
                  "Could not read /presence: " +
                    model.error +
                    ". " +
                    (model.lastPolledAt === null
                      ? "No poll has completed."
                      : "The last poll failed " +
                        ageLabelOf({ at: model.lastPolledAt, now }) +
                        ".") +
                    (model.lastSuccessAt === null
                      ? " There is no last good read."
                      : " The last good read was " +
                        ageLabelOf({ at: model.lastSuccessAt, now }) +
                        "; nothing on this page is current."),
                ],
              ),
            ]),
        ...(model.notice === null ? [] : [h.p([h.Class("notice")], [model.notice])]),
        ...(presence === null
          ? []
          : [
              stateMachine(h, presence.factory.workstreams, { observedAt, now }),
              ...Array.from(new Set(presence.factory.workstreams.map(repoName))).map((repo) =>
                repoSection(
                  h,
                  repo,
                  presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
                  sessionsOf(presence),
                  { observedAt, now },
                ),
              ),
              card(
                h,
                "Desk",
                panelMeta(h, {
                  freshness,
                  observedAt,
                  now,
                  note: presence.factory.desk.length + " waiting",
                }),
                presence.factory.desk.map((item) => deskRow(h, item)),
              ),
              card(
                h,
                "Reports",
                panelMeta(h, {
                  freshness,
                  observedAt,
                  now,
                  note: presence.factory.reports.length + " read",
                }),
                presence.factory.reports.map((item) => reportRow(h, item, now)),
              ),
              ...(() => {
                const allSessions = sessionsOf(presence)
                const unmatched = allSessions.filter((session) => session.workstream === undefined)
                return unmatched.length === 0
                  ? []
                  : [
                      card(
                        h,
                        "Sessions not joined to a workstream",
                        panelMeta(h, { freshness, observedAt, now }),
                        unmatched.map((s) => sessionRow(h, s, { observedAt, now })),
                      ),
                    ]
              })(),
            ]),
      ],
    ),
  }
}
