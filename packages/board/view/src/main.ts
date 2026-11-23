import { Effect, Option, Result, Schema } from "effect"
import { Command, Runtime, Update } from "foldkit"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { ticks } from "foldkit-primitives/time"

import { Atlas, type AtlasPackage } from "./atlas.ts"
import { visionView } from "./vision.ts"
import {
  Activity,
  Desk,
  type Environment,
  Presence,
  Report,
  Session,
  SessionSource,
  Workstream,
  environmentsByWorkstream,
} from "./presence.ts"

export const Route = Schema.Literals(["factory", "tackle", "vision"])
export type Route = typeof Route.Type

export const Model = Schema.Struct({
  route: Route,
  presence: Schema.NullOr(Presence),
  atlas: Schema.NullOr(Atlas),
  error: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  visionStep: Schema.optional(Schema.Finite),
  visionFocus: Schema.optional(Schema.Literals(["permissions", "enterprise"])),
  visionMachine: Schema.optional(Schema.String),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ClickedRefresh: {},
  Settled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
  AtlasSettled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
  Ticked: {},
  ClickedOpen: { source: SessionSource, address: Schema.String },
  Opened: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
  ClickedAnswer: { item: Schema.String, choice: Schema.String },
  Answered: { ok: Schema.Boolean, error: Schema.NullOr(Schema.String) },
  VisionStep: { step: Schema.Finite },
  VisionNext: {},
  VisionReset: {},
  VisionFocus: { focus: Schema.Literals(["permissions", "enterprise"]) },
  VisionMachine: { machine: Schema.String },
})
export type Message = typeof Message.Type

type UpdateReturn = Update.Return<Model, Message>

/** The Foldkit update function: every transition is explicit here. */
export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedRefresh: () =>
      model.route === "vision"
        ? { model }
        : {
            model: { ...model, loading: true },
            commands: [model.route === "tackle" ? FetchAtlas() : FetchPresence()],
          },
    Ticked: () =>
      model.loading || model.route === "vision"
        ? { model }
        : {
            model: { ...model, loading: true },
            commands: [model.route === "tackle" ? FetchAtlas() : FetchPresence()],
          },
    Settled: ({ value, error }) => {
      if (error !== null) return { model: { ...model, presence: null, error, loading: false } }
      const decoded = Schema.decodeUnknownResult(Presence)(value)
      return Result.isSuccess(decoded)
        ? { model: { ...model, presence: decoded.success, error: null, loading: false } }
        : { model: { ...model, presence: null, error: String(decoded.failure), loading: false } }
    },
    AtlasSettled: ({ value, error }) => {
      if (error !== null) return { model: { ...model, atlas: null, error, loading: false } }
      const decoded = Schema.decodeUnknownResult(Atlas)(value)
      return Result.isSuccess(decoded)
        ? { model: { ...model, atlas: decoded.success, error: null, loading: false } }
        : { model: { ...model, atlas: null, error: String(decoded.failure), loading: false } }
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
    VisionStep: ({ step }) => ({ model: { ...model, visionStep: step } }),
    VisionNext: () => ({
      model: {
        ...model,
        visionStep: (model.visionStep ?? 0) >= 5 ? 0 : (model.visionStep ?? 0) + 1,
      },
    }),
    VisionReset: () => ({ model: { ...model, visionStep: 0 } }),
    VisionFocus: ({ focus }) => ({ model: { ...model, visionFocus: focus } }),
    VisionMachine: ({ machine }) => ({ model: { ...model, visionMachine: machine } }),
    Answered: ({ ok, error }) => ({
      model: {
        ...model,
        notice: ok ? "Decision recorded" : "Could not record: " + (error ?? "unknown error"),
      },
      commands: ok ? [FetchPresence()] : [],
    }),
  })

/** Start with a fetch and an empty model. */
const routeOf = (): Route => {
  if (typeof window === "undefined") return "factory"
  if (window.location.pathname.startsWith("/tackle")) return "tackle"
  if (window.location.pathname.startsWith("/vision")) return "vision"
  return "factory"
}

export const init: Runtime.ApplicationInit<Model, Message> = () => {
  const route = routeOf()
  return {
    model: {
      route,
      presence: null,
      atlas: null,
      error: null,
      loading: route !== "vision",
      notice: null,
      visionStep: 0,
      visionFocus: "permissions",
      visionMachine: "mbp1",
    },
    commands: route === "vision" ? [] : [route === "tackle" ? FetchAtlas() : FetchPresence()],
  }
}

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

export const FetchAtlas = Command.define("FetchAtlas", {
  messages: [Message.AtlasSettled],
  execute: Effect.tryPromise({
    try: async () => {
      const response = await fetch("/atlas")
      if (!response.ok) return Promise.reject("HTTP " + response.status)
      return await response.json()
    },
    catch: (cause) => String(cause),
  }).pipe(
    Effect.match({
      onFailure: (error) => Message.AtlasSettled({ value: null, error: String(error) }),
      onSuccess: (value) => Message.AtlasSettled({ value, error: null }),
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
            [
              h.Class("brand " + session.source),
              h.OnClick(Message.ClickedOpen({ source: session.source, address: session.address })),
            ],
            [session.source === "herdr" ? "Herdr" : "Rex"],
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

/**
 * The Environment line: machine, runtime and the agent working the card.
 *
 * Each part is drawn only when the projection sent it, and a card with no environment at all
 * draws no line. A worktree is named by its path because that is what "runtime" means today.
 */
const environmentLine = (h: HtmlBuilder<Message>, environment: Environment | undefined) => {
  if (environment === undefined) return h.span([], [])
  const machine = environment.machine
  const runtime = environment.runtime
  const port = environment.port
  const services = environment.services ?? []
  const preview = environment.preview
  const agent = environment.agent
  const parts = [
    ...(machine === null || machine === undefined
      ? []
      : [h.span([h.Class("mono")], ["machine " + machine.host])]),
    ...(runtime === undefined
      ? []
      : [h.span([h.Class("mono")], [runtime.kind + " " + runtime.path])]),
    ...(port === null || port === undefined
      ? []
      : [h.span([h.Class("mono")], ["port " + port.number])]),
    // One span, because a service is one fact: the name the room declared and the word the probe
    // earned. The card never says "healthy" for a service the board did not observe answering.
    ...(services.length === 0
      ? []
      : [
          h.span(
            [h.Class("mono")],
            [
              services
                .map((service) => "service " + service.name + " " + service.status)
                .join(", "),
            ],
          ),
        ]),
    // The route is the board's own path, so it is resolved against the origin that served the
    // card. A null preview is no route: the card never links to a service nobody saw answering.
    ...(preview === null || preview === undefined
      ? []
      : [
          h.a(
            [h.Href(preview), h.Target("_blank"), h.Rel("noreferrer"), h.Class("mono")],
            ["preview " + preview],
          ),
        ]),
    ...(agent === null || agent === undefined
      ? []
      : [
          h.span(
            [],
            // A session the board could not read a status for names only itself; an empty
            // status is not a word, and Herdr draws no badge for it either.
            [
              agent.status === ""
                ? "agent " + agent.session
                : "agent " + agent.session + " · " + agent.status,
            ],
          ),
        ]),
  ]
  if (parts.length === 0) return h.span([], [])
  return h.div(
    [h.Class("environment")],
    [h.span([h.Class("environment-label")], ["Environment"]), ...parts],
  )
}

const githubRepoUrl = (repo: string): string => "https://github.com/" + repo

const githubPrUrl = (repo: string, pr: number): string =>
  "https://github.com/" + repo + "/pull/" + String(pr)

const githubLabelUrl = (repo: string, label: string): string =>
  "https://github.com/" + repo + "/issues?q=label%3A" + encodeURIComponent(label)

const brandLink = (h: HtmlBuilder<Message>, kind: string, label: string, href: string) =>
  h.a([h.Class("brand " + kind), h.Href(href), h.Target("_blank"), h.Rel("noreferrer")], [label])

const workstreamBrands = (h: HtmlBuilder<Message>, ws: typeof Workstream.Type) => {
  const repo = ws.repo
  return h.div(
    [h.Class("brand-row")],
    [
      ...(repo === undefined
        ? []
        : [brandLink(h, "github", "GitHub · " + repo, githubRepoUrl(repo))]),
      ...(repo === undefined || ws.pr === undefined
        ? []
        : [brandLink(h, "github", "PR #" + ws.pr, githubPrUrl(repo, ws.pr))]),
      ...(repo === undefined
        ? []
        : [brandLink(h, "label", "Label · " + ws.label, githubLabelUrl(repo, ws.label))]),
      ...(ws.linearUrl === undefined
        ? []
        : [brandLink(h, "linear", "Linear · " + ws.project, ws.linearUrl)]),
    ],
  )
}

const workstreamCard = (
  h: HtmlBuilder<Message>,
  ws: typeof Workstream.Type,
  activity: typeof Activity.Type | undefined,
  sessions: ReadonlyArray<typeof Session.Type>,
  environment: Environment | undefined,
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
          ...(ws.worker === undefined ? [] : [h.span([h.Class("mono")], ["worker " + ws.worker])]),
        ],
      ),
      workstreamBrands(h, ws),
      environmentLine(h, environment),
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
  environments: Readonly<Record<string, Environment>>,
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
                  environments[ws.id],
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

const routeNav = (h: HtmlBuilder<Message>, active: Route) =>
  h.div(
    [h.Class("nav")],
    [
      h.a([h.Href("/"), ...(active === "factory" ? [h.Class("active")] : [])], ["Factory"]),
      h.a([h.Href("/tackle"), ...(active === "tackle" ? [h.Class("active")] : [])], ["Tackle"]),
      h.a([h.Href("/vision"), ...(active === "vision" ? [h.Class("active")] : [])], ["Vision"]),
    ],
  )

const appHeader = (h: HtmlBuilder<Message>, model: Model, title: string, summary: string) =>
  h.header(
    [h.Class("header")],
    [
      h.div(
        [],
        [h.h1([], [title]), h.span([h.Class("muted")], [summary]), routeNav(h, model.route)],
      ),
      model.route === "vision"
        ? h.span([h.Class("muted")], ["static map"])
        : h.button(
            [h.OnClick(Message.ClickedRefresh())],
            [model.loading ? "Refreshing…" : "Refresh"],
          ),
    ],
  )

/** Render the factory state; every field comes from /presence. */

const factoryFloor = (
  h: HtmlBuilder<Message>,
  environments: ReadonlyArray<Environment>,
  tailnet: import("./presence.ts").Tailnet | undefined,
) => {
  if (environments.length === 0 && tailnet === undefined) return h.span([], [])
  const machines = new Map<
    string,
    { readonly online: boolean | undefined; readonly entries: Array<Environment> }
  >()
  for (const peer of [
    ...(tailnet?.self === undefined ? [] : [tailnet.self]),
    ...(tailnet?.peers ?? []),
  ])
    machines.set(peer.host, { online: peer.online, entries: [] })
  for (const environment of environments) {
    const host = environment.machine?.host ?? "unplaced"
    const current = machines.get(host) ?? { online: undefined, entries: [] }
    current.entries.push(environment)
    machines.set(host, current)
  }
  const online = [...machines.values()].filter((machine) => machine.online === true).length
  return h.section(
    [h.Class("factory-floor")],
    [
      h.div(
        [h.Class("floor-head")],
        [
          h.h2([], ["Factory floor"]),
          h.span(
            [h.Class("muted")],
            [
              (tailnet === undefined || !tailnet.available
                ? "tailnet unavailable"
                : online + " online · " + machines.size + " machines") +
                " · " +
                environments.length +
                (environments.length === 1 ? " workstream" : " workstreams"),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("floor-grid")],
        [...machines.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([host, machine]) =>
            h.div(
              [h.Class("floor-machine")],
              [
                h.div(
                  [h.Class("floor-machine-head")],
                  [
                    h.h3([], [host]),
                    h.span(
                      [
                        h.Class(
                          "floor-status " +
                            (machine.online === true
                              ? "online"
                              : machine.online === false
                                ? "offline"
                                : "unknown"),
                        ),
                      ],
                      [
                        machine.online === true
                          ? "online"
                          : machine.online === false
                            ? "offline"
                            : "observed",
                      ],
                    ),
                  ],
                ),
                ...(machine.entries.length === 0
                  ? [h.span([h.Class("muted")], ["no workstream observed"])]
                  : machine.entries.map((environment) => {
                      const services = environment.services ?? []
                      const preview = environment.preview
                      const port = environment.port
                      const agent = environment.agent
                      return h.div(
                        [h.Class("floor-workstream")],
                        [
                          h.a([h.Href("#" + environment.workstream)], [environment.workstream]),
                          h.span(
                            [h.Class("muted")],
                            [
                              environment.runtime === undefined
                                ? "no runtime"
                                : environment.runtime.kind +
                                  " · " +
                                  environment.runtime.path.split("/").at(-1),
                            ],
                          ),
                          h.span(
                            [h.Class("floor-service")],
                            [
                              port === null || port === undefined
                                ? "no port"
                                : "port " + port.number,
                              " · ",
                              services.length === 0
                                ? "no service"
                                : services
                                    .map((service) => service.name + " · " + service.status)
                                    .join(", "),
                            ],
                          ),
                          agent === null || agent === undefined
                            ? h.span([], [])
                            : h.span(
                                [h.Class("floor-service")],
                                [
                                  "agent " +
                                    agent.session +
                                    (agent.status === "" ? "" : " · " + agent.status),
                                ],
                              ),
                          preview === null || preview === undefined
                            ? h.span([], [])
                            : h.a(
                                [h.Href(preview), h.Target("_blank"), h.Rel("noreferrer")],
                                ["preview " + preview],
                              ),
                        ],
                      )
                    })),
              ],
            ),
          ),
      ),
    ],
  )
}

const factoryView = (model: Model, h: HtmlBuilder<Message>): Document => {
  const presence = model.presence
  const summary =
    presence === null
      ? "waiting for presence"
      : (() => {
          const count = presence.factory.workstreams.length
          const repos = new Set(presence.factory.workstreams.map(repoName)).size
          const waiting = presence.factory.activity.reduce(
            (total, activity) => total + activity.pending.length,
            0,
          )
          return (
            count +
            (count === 1 ? " workstream" : " workstreams") +
            " · " +
            repos +
            (repos === 1 ? " repo" : " repos") +
            (waiting === 0 ? "" : " · " + waiting + " waiting")
          )
        })()
  return {
    title: "Software factory",
    body: h.div(
      [h.Class("shell")],
      [
        appHeader(h, model, "Software factory", summary),
        ...(model.error === null
          ? []
          : [h.p([h.Class("error")], ["Could not read /presence: " + model.error])]),
        ...(model.notice === null ? [] : [h.p([h.Class("notice")], [model.notice])]),
        ...(presence === null
          ? []
          : [
              factoryFloor(h, presence.factory.environments ?? [], presence.network?.tailscale),
              ...Array.from(new Set(presence.factory.workstreams.map(repoName))).map((repo) =>
                repoSection(
                  h,
                  repo,
                  presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
                  presence.factory.activity,
                  [...presence.sessions.herdr.sessions, ...presence.sessions.rex.sessions],
                  environmentsByWorkstream(presence.factory.environments),
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

interface AtlasLayer {
  readonly id: string
  readonly title: string
  readonly note: string
  readonly names: ReadonlyArray<string>
}

const ATLAS_LAYERS: ReadonlyArray<AtlasLayer> = [
  {
    id: "seam",
    title: "Format seam",
    note: "The wire contract. No runtime, no dependencies.",
    names: ["@autotelic/protocol"],
  },
  {
    id: "conformance",
    title: "Conformance",
    note: "The tools that check the tools, and the one that drives them.",
    names: ["@autotelic/plumb", "@autotelic/joggle", "@autotelic/cutlist", "@autotelic/jig-cli"],
  },
  {
    id: "factory",
    title: "Factory and runtime",
    note: "Passes, worktrees, one port, one service, one read surface.",
    names: ["@autotelic/board", "@autotelic/room"],
  },
  {
    id: "view",
    title: "Board UI",
    note: "The board's FoldKit client. It reads /presence and /atlas; it imports neither.",
    names: ["@autotelic/board-view"],
  },
  {
    id: "separate",
    title: "Separate system",
    note: "An independent loop engine; not on the factory's execution path.",
    names: ["@autotelic/treadle"],
  },
]

const shortName = (name: string): string => name.replace("@autotelic/", "")
const githubUrl = (path: string): string => "https://github.com/autotelic/tackle/tree/main/" + path

const chip = (h: HtmlBuilder<Message>, text: string) => h.span([h.Class("chip")], [text])

const atlasPackageCard = (
  h: HtmlBuilder<Message>,
  entry: AtlasPackage,
  edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
) => {
  const dependencies = entry.workspaceDependencies ?? []
  const description = entry.description?.trim() ?? ""
  const summary = entry.summary?.trim() ?? ""
  // The manifest description is already the short answer; the README paragraph is the
  // fallback for a package that has none, not a second first paragraph.
  const showSummary = description === "" && summary !== ""
  const usedBy = edges.filter((edge) => edge.to === entry.name).map((edge) => shortName(edge.from))
  return h.div(
    [h.Class("package-card")],
    [
      h.div(
        [h.Class("package-head")],
        [
          h.h3([], [h.a([h.Href(githubUrl(entry.path))], [shortName(entry.name)])]),
          h.span([h.Class("package-version")], [entry.version ?? "0.0.0"]),
        ],
      ),
      entry.description === undefined || entry.description === ""
        ? h.span([], [])
        : h.p([h.Class("package-description")], [entry.description]),
      showSummary ? h.p([h.Class("package-summary")], [summary]) : h.span([], []),
      h.div(
        [h.Class("package-meta")],
        [
          h.span([h.Class("mono")], [entry.path]),
          entry.private === true ? chip(h, "private") : chip(h, "published"),
          ...(entry.scripts ?? []).slice(0, 4).map((script) => chip(h, script)),
        ],
      ),
      h.div(
        [h.Class("package-deps")],
        dependencies.length === 0
          ? [h.span([h.Class("muted")], ["no workspace dependencies"])]
          : [
              h.span([h.Class("muted")], ["depends on"]),
              ...dependencies.map((dependency) => chip(h, shortName(dependency))),
            ],
      ),
      usedBy.length === 0
        ? h.span([], [])
        : h.div(
            [h.Class("package-deps")],
            [h.span([h.Class("muted")], ["used by"]), ...usedBy.map((name) => chip(h, name))],
          ),
    ],
  )
}

const atlasLayer = (
  h: HtmlBuilder<Message>,
  layer: AtlasLayer,
  packages: ReadonlyArray<AtlasPackage>,
  edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
) =>
  packages.length === 0
    ? h.span([], [])
    : h.section(
        [h.Id(layer.id), h.Class("atlas-layer")],
        [
          h.div(
            [h.Class("atlas-layer-head")],
            [h.h2([], [layer.title]), h.span([h.Class("count")], [String(packages.length)])],
          ),
          h.p([h.Class("atlas-layer-note")], [layer.note]),
          h.div(
            [h.Class("package-grid")],
            packages.map((entry) => atlasPackageCard(h, entry, edges)),
          ),
        ],
      )

const atlasView = (model: Model, h: HtmlBuilder<Message>): Document => {
  const atlas = model.atlas
  const packages = atlas?.packages ?? []
  const edges = atlas?.edges ?? []
  const known = new Set(ATLAS_LAYERS.flatMap((layer) => layer.names))
  const other = packages.filter((entry) => !known.has(entry.name))
  const summary =
    atlas === null
      ? "waiting for the package atlas"
      : packages.length +
        (packages.length === 1 ? " package" : " packages") +
        " · " +
        edges.length +
        (edges.length === 1 ? " workspace edge" : " workspace edges")
  return {
    title: "Tackle overview",
    body: h.div(
      [h.Class("shell")],
      [
        appHeader(h, model, "Tackle", summary),
        ...(model.error === null
          ? []
          : [h.p([h.Class("error")], ["Could not read /atlas: " + model.error])]),
        ...(atlas === null
          ? []
          : [
              card(h, {
                title: "What this is",
                children: [
                  h.p(
                    [],
                    [
                      "The workspace is a set of small tools that agree on formats, not a monolith. " +
                        "The seam is @autotelic/protocol; everything else is a role that reads or writes a format.",
                    ],
                  ),
                  h.p(
                    [h.Class("muted")],
                    [
                      "Every card is read from its package.json and README at request time. " +
                        "The dependency chips are workspace edges; external packages are deliberately left out.",
                    ],
                  ),
                ],
              }),
              ...ATLAS_LAYERS.map((layer) =>
                atlasLayer(
                  h,
                  layer,
                  packages.filter((entry) => layer.names.includes(entry.name)),
                  edges,
                ),
              ),
              ...(other.length === 0
                ? []
                : [
                    atlasLayer(
                      h,
                      {
                        id: "other",
                        title: "Other",
                        note: "Packages this page has not classified yet.",
                        names: [],
                      },
                      other,
                      edges,
                    ),
                  ]),
            ]),
      ],
    ),
  }
}

/** The route selector: /tackle is the workspace atlas, everything else is the factory. */
export const view = (model: Model, h: HtmlBuilder<Message>): Document =>
  model.route === "tackle"
    ? atlasView(model, h)
    : model.route === "vision"
      ? visionView(model, h)
      : factoryView(model, h)
