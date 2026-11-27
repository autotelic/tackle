import { Command, Head, Subscription, UiSchema } from "@effect/ui"
import type { View } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Effect, Match, Result, Schema, Stream } from "effect"

import { Atlas, type AtlasPackage } from "./atlas.ts"
import { visionView } from "./vision.ts"
import {
  Activity,
  type Candidate,
  Desk,
  type Environment,
  Fleet,
  Presence,
  Report,
  type Room,
  Session,
  SessionSource,
  type Tailnet,
  Workstream,
  candidatesByWorkstream,
  environmentsByWorkstream,
} from "./presence.ts"

export const Route = Schema.Literals(["factory", "tackle", "vision"])
export type Route = typeof Route.Type

export const Model = Schema.Struct({
  route: Route,
  presence: Schema.NullOr(Presence),
  // The peers' environments. Absent on a board that serves no /fleet, which draws no section.
  fleet: Schema.optional(Schema.NullOr(Fleet)),
  atlas: Schema.NullOr(Atlas),
  error: Schema.NullOr(Schema.String),
  loading: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
  visionStep: Schema.optional(Schema.Finite),
  visionFocus: Schema.optional(Schema.Literals(["permissions", "enterprise"])),
  visionMachine: Schema.optional(Schema.String),
})
export type Model = typeof Model.Type

/**
 * Every fact the page can report.
 *
 * The two fetches carry one message each, with the error beside the value, because the view's
 * whole response to either is the same: draw the document or draw the failure.
 */
export const Message = UiSchema.TaggedEnum({
  ClickedRefresh: {},
  Settled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
  AtlasSettled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
  FleetSettled: { value: Schema.Unknown, error: Schema.NullOr(Schema.String) },
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

/** One message the view can draw: the type a helper threads through `h`. */
type Content = View.Input<Message, any>

const fetchJson = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(path)
      if (!response.ok) return Promise.reject("HTTP " + response.status)
      return await response.json()
    },
    catch: (cause) => String(cause),
  })

/**
 * The two reads.
 *
 * Written with `Command.make` over the page's own `fetch`, as the page's source of truth is
 * the board's JSON, not a service the view owns. The cost is that a test cannot fake the
 * request in a Story; the seam is covered by decoding the served documents instead.
 */
export const FetchPresence = Command.make("board/FetchPresence", { args: {} }, () =>
  fetchJson("/presence").pipe(
    Effect.match({
      onFailure: (error) => Message.Settled({ value: null, error }),
      onSuccess: (value) => Message.Settled({ value, error: null }),
    }),
  ),
)

/**
 * The peers' environments, read separately from /presence.
 *
 * A failure here is not the page's failure: the floor is local first, and a peer document that
 * does not answer draws no Peer section rather than blanking the factory.
 */
export const FetchFleet = Command.make("board/FetchFleet", { args: {} }, () =>
  fetchJson("/fleet").pipe(
    Effect.match({
      onFailure: (error) => Message.FleetSettled({ value: null, error }),
      onSuccess: (value) => Message.FleetSettled({ value, error: null }),
    }),
  ),
)

export const FetchAtlas = Command.make("board/FetchAtlas", { args: {} }, () =>
  fetchJson("/atlas").pipe(
    Effect.match({
      onFailure: (error) => Message.AtlasSettled({ value: null, error }),
      onSuccess: (value) => Message.AtlasSettled({ value, error: null }),
    }),
  ),
)

/** The one action the view takes: record a choice on the desk. */
export const AnswerDesk = Command.make(
  "board/AnswerDesk",
  { args: { item: Schema.String, choice: Schema.String }, mode: "switch" },
  ({ item, choice }) =>
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
)

/** Focus a session in the app that owns it; the board validates the address it is handed. */
export const OpenSession = Command.make(
  "board/OpenSession",
  { args: { source: SessionSource, address: Schema.String }, mode: "switch" },
  ({ source, address }) =>
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
)

/**
 * Presence refreshes itself; the button is for impatience, not the only path.
 *
 * A Subscription rather than a timer the view owns: its lifetime is the Model's, and the
 * vision route reads no presence, so it asks for none.
 */
const presenceTicks = Subscription.make(
  "presence-ticks",
  Stream.tick("20 seconds").pipe(Stream.as(Message.Ticked())),
)

/** Start with a fetch and an empty model. */
const routeOf = (): Route => {
  if (typeof window === "undefined") return "factory"
  if (window.location.pathname.startsWith("/tackle")) return "tackle"
  if (window.location.pathname.startsWith("/vision")) return "vision"
  return "factory"
}

/** The one fetch a route needs to fill an empty model. */
const fetchFor = (route: Route) => (route === "tackle" ? FetchAtlas.make() : FetchPresence.make())

const titleOf = (route: Route): string =>
  Match.value(route).pipe(
    Match.when("tackle", () => "Tackle overview"),
    Match.when("vision", () => "Tackle — how the factory moves"),
    Match.when("factory", () => "Software factory"),
    Match.exhaustive,
  )

export const BoardView = Html.component({
  name: "BoardView",
  model: Model,
  message: Message,
}).make({
  /**
   * Start the application: the route comes from the path, and every other field is empty.
   *
   * @returns the initial model, plus the one fetch the route needs to fill it.
   */
  init: ($) => {
    const route = routeOf()
    const initial = $.set({
      route,
      presence: null,
      fleet: null,
      atlas: null,
      error: null,
      loading: route !== "vision",
      notice: null,
      visionStep: 0,
      visionFocus: "permissions" as const,
      visionMachine: "mbp1",
    })
    if (route === "vision") return initial
    // The floor reads two documents: its own presence, and the peers' environments. They are
    // fetched together so a slow peer never delays the local rows.
    return route === "factory"
      ? initial.run(FetchPresence.make(), FetchFleet.make())
      : initial.run(fetchFor(route))
  },

  /** The update function: every transition is explicit here. */
  update: {
    ClickedRefresh: ($) =>
      $.model.route === "vision"
        ? $.model
        : $.evolve({ loading: true }).run(fetchFor($.model.route)),
    Ticked: ($) =>
      $.model.loading || $.model.route === "vision"
        ? $.model
        : $.evolve({ loading: true }).run(
            ...($.model.route === "factory"
              ? [FetchPresence.make(), FetchFleet.make()]
              : [fetchFor($.model.route)]),
          ),
    Settled: ($, { value, error }) => {
      if (error !== null) return $.evolve({ presence: null, error, loading: false })
      const decoded = Schema.decodeUnknownResult(Presence)(value)
      return Result.isSuccess(decoded)
        ? $.evolve({ presence: decoded.success, error: null, loading: false })
        : $.evolve({ presence: null, error: String(decoded.failure), loading: false })
    },
    FleetSettled: ($, { value, error }) => {
      // A peer document that did not arrive clears the peer section and leaves the local floor
      // exactly as it was: the two reads fail independently.
      if (error !== null) return $.evolve({ fleet: null })
      const decoded = Schema.decodeUnknownResult(Fleet)(value)
      return Result.isSuccess(decoded)
        ? $.evolve({ fleet: decoded.success })
        : $.evolve({ fleet: null })
    },
    AtlasSettled: ($, { value, error }) => {
      if (error !== null) return $.evolve({ atlas: null, error, loading: false })
      const decoded = Schema.decodeUnknownResult(Atlas)(value)
      return Result.isSuccess(decoded)
        ? $.evolve({ atlas: decoded.success, error: null, loading: false })
        : $.evolve({ atlas: null, error: String(decoded.failure), loading: false })
    },
    ClickedOpen: ($, { source, address }) =>
      $.set($.model).run(OpenSession.make({ source, address })),
    Opened: ($, { ok, error }) =>
      $.evolve({
        notice: ok ? "Opened in its app" : "Could not open: " + (error ?? "unknown error"),
      }),
    ClickedAnswer: ($, { item, choice }) => $.set($.model).run(AnswerDesk.make({ item, choice })),
    Answered: ($, { ok, error }) => {
      const evolved = $.evolve({
        notice: ok ? "Decision recorded" : "Could not record: " + (error ?? "unknown error"),
      })
      return ok ? evolved.run(FetchPresence.make()) : evolved
    },
    VisionStep: ($, { step }) => $.evolve({ visionStep: step }),
    VisionNext: ($) =>
      $.evolve({
        visionStep: (step) => ((step ?? 0) >= 5 ? 0 : (step ?? 0) + 1),
      }),
    VisionReset: ($) => $.evolve({ visionStep: 0 }),
    VisionFocus: ($, { focus }) => $.evolve({ visionFocus: focus }),
    VisionMachine: ($, { machine }) => $.evolve({ visionMachine: machine }),
  },

  subscriptions: ({ model }) => (model.route === "vision" ? [] : [presenceTicks]),

  head: ({ model }) => [Head.title(titleOf(model.route))],

  view: (h, model) =>
    Match.value(model.route).pipe(
      Match.when("tackle", () => atlasView(h, model)),
      Match.when("vision", () => visionView(h, model)),
      Match.when("factory", () => factoryView(h, model)),
      Match.exhaustive,
    ),
})

const phaseOrder = ["reconcile", "build", "compress", "land", "blocked", "done"] as const
const phaseName = {
  reconcile: "Reconcile",
  build: "Build",
  compress: "Compress",
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
    case "compress":
      return phaseName.compress
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

const sessionRow = (h: Html.H<Message>, session: typeof Session.Type) =>
  h.div.class("session").children(
    h.div
      .class("session-main")
      .children(
        h.span.class("session-id").children(session.source + " " + session.address),
        h.span.class("muted").children(session.where ?? session.agent ?? ""),
      ),
    h.div.class("session-actions").children(
      h.button
        .class("brand " + session.source)
        .on("click", Message.ClickedOpen({ source: session.source, address: session.address }))
        .children(session.source === "herdr" ? "Herdr" : "Rex"),
    ),
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

const activityBlock = (h: Html.H<Message>, activity: typeof Activity.Type | undefined) => {
  if (activity === undefined) return undefined
  const pass = activity.lastPass
  const running = activity.state === "working"
  const waiting = activity.pending.length
  const stalled = activity.progress?.stalled === true
  const stalledPasses = activity.progress?.consecutive ?? 0
  const age = formatDuration(activity.ageMinutes)
  const push =
    pass?.commit === undefined ? "" : pass.pushed === true ? " · pushed" : " · not pushed"
  const last =
    pass === null
      ? ""
      : running
        ? "Pass #" + pass.pass + " running" + push
        : "Pass #" + pass.pass + " · " + age + " ago" + push
  const quality = pass?.quality?.after
  const gate =
    quality === undefined
      ? ""
      : quality.available === false
        ? "Gate unmeasured"
        : quality.complete === false
          ? "Gate incomplete · " +
            (quality.unjudged ?? 0) +
            " unjudged" +
            (quality.scope === undefined ? "" : " · " + quality.scope)
          : quality.errors === 0
            ? "Gate green"
            : "Gate red · " + quality.errors + " errors"
  const lastEvent = activity.lastEvent
  if (last === "" && waiting === 0 && gate === "") return undefined
  const queue: ReadonlyArray<Content> = activity.pending.map((event) =>
    h.details
      .class("queue-item")
      .children(
        h.summary.children(queueTitle(event)),
        h.p.class("queue-detail").children(event.summary ?? "No further detail."),
      ),
  )
  return h.div
    .class("activity", stalled && "capped", running && "running")
    .children(
      last === ""
        ? undefined
        : h.div
            .class("activity-head")
            .children(
              h.span.class("activity-last").children(last),
              stalled
                ? h.span.class("stale-flag").children(stalledPasses + " passes without progress")
                : undefined,
            ),
      waiting === 0
        ? undefined
        : h.div
            .class("activity-queue")
            .children(h.div.class("queue-count").children(waiting + " waiting"), ...queue),
      stalled
        ? h.div
            .class("activity-event stale")
            .children("No measurable progress for " + stalledPasses + " passes")
        : undefined,
      lastEvent === null
        ? undefined
        : h.div
            .class("activity-event")
            .children(
              h.span.children("Last event · " + (lastEvent.summary ?? queueTitle(lastEvent))),
            ),
      gate === "" ? undefined : h.div.class("activity-meta").children(h.span.children(gate)),
    )
}

/**
 * The Environment line: machine, runtime and the agent working the card.
 *
 * Each part is drawn only when the projection sent it, and a card with no environment at all
 * draws no line. A worktree is named by its path because that is what "runtime" means today.
 */
const environmentLine = (h: Html.H<Message>, environment: Environment | undefined) => {
  if (environment === undefined) return undefined
  const machine = environment.machine
  const runtime = environment.runtime
  const port = environment.port
  const vmPort = environment.vmPort
  const services = environment.services ?? []
  const preview = environment.preview
  const agent = environment.agent
  const parts: ReadonlyArray<Content> = [
    ...(machine === null || machine === undefined
      ? []
      : [h.span.class("mono").children("machine " + machine.host)]),
    ...(runtime === undefined
      ? []
      : [h.span.class("mono").children(runtime.kind + " " + runtime.path)]),
    ...(port === null || port === undefined
      ? []
      : [h.span.class("mono").children("port " + port.number)]),
    ...(vmPort === null || vmPort === undefined
      ? []
      : [h.span.class("mono").children("vm port " + vmPort)]),
    // One span, because a service is one fact: the name the room declared and the word the probe
    // earned. The card never says "healthy" for a service the board did not observe answering.
    ...(services.length === 0
      ? []
      : [
          h.span
            .class("mono")
            .children(
              services
                .map((service) => "service " + service.name + " " + service.status)
                .join(", "),
            ),
        ]),
    // The route is the board's own path, so it is resolved against the origin that served the
    // card. A null preview is no route: the card never links to a service nobody saw answering.
    ...(preview === null || preview === undefined
      ? []
      : [
          h.a
            .class("mono")
            .attr("href", preview)
            .attr("target", "_blank")
            .attr("rel", "noreferrer")
            .children("preview " + preview),
        ]),
    // A session the board could not read a status for names only itself; an empty status is not
    // a word, and Herdr draws no badge for it either.
    ...(agent === null || agent === undefined
      ? []
      : [
          h.span.children(
            agent.status === ""
              ? "agent " + agent.session
              : "agent " + agent.session + " · " + agent.status,
          ),
        ]),
  ]
  if (parts.length === 0) return undefined
  return h.div
    .class("environment")
    .children(h.span.class("environment-label").children("Environment"), ...parts)
}

/**
 * One candidate lane, compact.
 *
 * Two open lanes are two rows: the card never folds them into a count, or a reader could not tell
 * which one the preview belongs to. A dropped lane carries no route, because the board stops
 * answering it.
 */
const candidateRow = (h: Html.H<Message>, candidate: Candidate) => {
  const preview = candidate.preview
  const services = candidate.services ?? []
  const port = candidate.port
  return h.div.class("candidate " + candidate.state).children(
    h.span.class("candidate-state").children(candidate.state),
    h.span.class("mono").children(candidate.label ?? candidate.id),
    h.span.class("mono muted").children(candidate.branch ?? candidate.id),
    candidate.head === undefined
      ? undefined
      : h.span.class("mono muted").children(candidate.head.slice(0, 8)),
    // The lease and the probe are the candidate's own room, not the workstream's: a lane with no
    // service says nothing rather than borrowing the row above it.
    port === null || port === undefined
      ? undefined
      : h.span.class("mono").children("port " + port.number),
    services.length === 0
      ? undefined
      : h.span
          .class("mono")
          .children(services.map((service) => service.name + " · " + service.status).join(", ")),
    preview === null || preview === undefined
      ? undefined
      : h.a
          .class("mono")
          .attr("href", preview)
          .attr("target", "_blank")
          .attr("rel", "noreferrer")
          .children("preview"),
  )
}

/**
 * The candidate lanes of one workstream, under its environment line.
 *
 * A dropped lane folds into one line: it is still a fact a human may want back, and hiding it
 * would make "where did that go" a question the floor cannot answer.
 *
 * @param candidates - the lanes the projection served for this workstream.
 * @returns the list, or nothing when the workstream has no candidate.
 */
const candidateList = (h: Html.H<Message>, candidates: ReadonlyArray<Candidate>) => {
  if (candidates.length === 0) return undefined
  const open = candidates.filter((candidate) => candidate.state !== "dropped")
  const dropped = candidates.length - open.length
  return h.div
    .class("candidates")
    .children(
      h.span.class("environment-label").children("Candidates"),
      ...open.map((candidate) => candidateRow(h, candidate)),
      dropped === 0
        ? undefined
        : h.div
            .class("candidate-dropped")
            .children(
              h.span
                .class("mono muted")
                .children(dropped + (dropped === 1 ? " dropped lane" : " dropped lanes")),
              ...candidates
                .filter((candidate) => candidate.state === "dropped")
                .map((candidate) =>
                  h.span.class("mono muted").children(candidate.label ?? candidate.id),
                ),
            ),
    )
}

const githubRepoUrl = (repo: string): string => "https://github.com/" + repo

const githubPrUrl = (repo: string, pr: number): string =>
  "https://github.com/" + repo + "/pull/" + String(pr)

const githubLabelUrl = (input: { readonly repo: string; readonly label: string }): string =>
  "https://github.com/" + input.repo + "/issues?q=label%3A" + encodeURIComponent(input.label)

const brandLink = (
  h: Html.H<Message>,
  input: { readonly kind: string; readonly label: string; readonly href: string },
) =>
  h.a
    .class("brand " + input.kind)
    .attr("href", input.href)
    .attr("target", "_blank")
    .attr("rel", "noreferrer")
    .children(input.label)

const workstreamBrands = (h: Html.H<Message>, ws: typeof Workstream.Type) => {
  const repo = ws.repo
  return h.div.class("brand-row").children(
    repo === undefined
      ? undefined
      : brandLink(h, { kind: "github", label: "GitHub · " + repo, href: githubRepoUrl(repo) }),
    repo === undefined || ws.pr === undefined
      ? undefined
      : brandLink(h, {
          kind: "github",
          label: "PR #" + ws.pr + " · " + ws.label,
          href: githubPrUrl(repo, ws.pr),
        }),
    repo === undefined
      ? undefined
      : brandLink(h, {
          kind: "label",
          label: "Label · " + ws.label,
          href: githubLabelUrl({ repo, label: ws.label }),
        }),
    ws.linearUrl === undefined
      ? undefined
      : brandLink(h, {
          kind: "linear",
          label: "Linear · " + ws.project,
          href: ws.linearUrl,
        }),
  )
}

const workstreamCard = (
  h: Html.H<Message>,
  ws: typeof Workstream.Type,
  activity: typeof Activity.Type | undefined,
  sessions: ReadonlyArray<typeof Session.Type>,
  environment: Environment | undefined,
  candidates: ReadonlyArray<Candidate>,
) =>
  h.article
    .attr("id", ws.id)
    .class("workstream")
    .children(
      h.div
        .class("workstream-head")
        .children(
          h.div.children(h.h3.children(ws.label), h.div.class("mono muted").children(ws.id)),
          h.div
            .class("pills")
            .children(
              activity === undefined
                ? undefined
                : h.span.class("state-pill " + activity.state).children(stateName(activity.state)),
            ),
        ),
      h.div.class("workstream-meta").children(
        ws.repo === undefined
          ? h.span.children("unknown repo")
          : h.a
              .attr("href", "https://github.com/" + ws.repo)
              .attr("target", "_blank")
              .attr("rel", "noreferrer")
              .children(ws.repo),
        h.span.children(ws.branch ?? "no branch"),
        ws.pr === undefined
          ? h.span.children("trunk")
          : h.a
              .attr("href", "https://github.com/" + (ws.repo ?? "") + "/pull/" + ws.pr)
              .attr("target", "_blank")
              .attr("rel", "noreferrer")
              .children("PR #" + ws.pr),
        h.span.class("mono").children("checkpoint " + ws.checkpoint.sha.slice(0, 8)),
        ws.worker === undefined ? undefined : h.span.class("mono").children("worker " + ws.worker),
      ),
      workstreamBrands(h, ws),
      environmentLine(h, environment),
      candidateList(h, candidates),
      activityBlock(h, activity),
      sessions.length === 0
        ? undefined
        : h.div.class("session-list").children(sessions.map((session) => sessionRow(h, session))),
    )

const repoSection = (
  h: Html.H<Message>,
  repo: string,
  workstreams: ReadonlyArray<typeof Workstream.Type>,
  activities: ReadonlyArray<typeof Activity.Type>,
  sessions: ReadonlyArray<typeof Session.Type>,
  environments: Readonly<Record<string, Environment>>,
  candidates: Readonly<Record<string, ReadonlyArray<Candidate>>>,
) => {
  const lanes: ReadonlyArray<Content> = phaseOrder.flatMap((phase) => {
    const inPhase = workstreams.filter((ws) => ws.phase === phase)
    if (inPhase.length === 0) return []
    return [
      h.div.class("lane").children(
        h.h3
          .class("lane-title")
          .children(phaseLabel(phase), h.span.class("count").children(String(inPhase.length))),
        ...inPhase.map((ws) =>
          workstreamCard(
            h,
            ws,
            activities.find((activity) => activity.workstream === ws.id),
            sessions.filter((session) => session.workstream === ws.id),
            environments[ws.id],
            candidates[ws.id] ?? [],
          ),
        ),
      ),
    ]
  })
  return h.section
    .class("repo")
    .children(
      h.div
        .class("repo-head")
        .children(
          h.h2.children(repo),
          h.span
            .class("muted")
            .children(
              workstreams.length + (workstreams.length === 1 ? " workstream" : " workstreams"),
            ),
        ),
      ...lanes,
    )
}

const card = (
  h: Html.H<Message>,
  input: {
    readonly title: string
    readonly children: ReadonlyArray<Content>
    readonly id?: string
  },
) =>
  h.div
    .class("card")
    .attr("id", input.id)
    .children(h.h2.children(input.title), ...input.children)

const deskRow = (h: Html.H<Message>, item: typeof Desk.Type) =>
  h.div
    .attr("id", item.id)
    .class("desk-item")
    .children(
      h.div
        .class("desk-head")
        .children(
          h.span.class("desk-title").children(item.title),
          h.a.attr("href", "#" + item.workstream).children(item.workstream),
        ),
      h.p.class("desk-body").children(item.body),
      h.div
        .class("desk-choices")
        .children(
          item.choices.map((choice) =>
            h.button.on("click", Message.ClickedAnswer({ item: item.id, choice })).children(choice),
          ),
        ),
    )

const reportRow = (h: Html.H<Message>, report: typeof Report.Type) =>
  h.div
    .class("report")
    .children(
      h.div
        .class("report-head")
        .children(
          h.span.class("id").children(report.kind),
          h.a.attr("href", "#" + report.workstream).children(report.workstream),
          report.blocked ? h.span.class("blocked-flag").children("blocked") : undefined,
        ),
      h.p.class("report-body").children(report.actual),
    )

const routeNav = (h: Html.H<Message>, active: Route) =>
  h.div.class("nav").children(
    h.a
      .class(active === "factory" && "active")
      .attr("href", "/")
      .children("Factory"),
    h.a
      .class(active === "tackle" && "active")
      .attr("href", "/tackle")
      .children("Tackle"),
    h.a
      .class(active === "vision" && "active")
      .attr("href", "/vision")
      .children("Vision"),
  )

const appHeader = (
  h: Html.H<Message>,
  input: { readonly model: Model; readonly title: string; readonly summary: string },
) =>
  h.header
    .class("header")
    .children(
      h.div.children(
        h.h1.children(input.title),
        h.span.class("muted").children(input.summary),
        routeNav(h, input.model.route),
      ),
      input.model.route === "vision"
        ? h.span.class("muted").children("static map")
        : h.button
            .on("click", Message.ClickedRefresh())
            .children(input.model.loading ? "Refreshing…" : "Refresh"),
    )

/**
 * Tailnet presence is three states, and the border class and the word beside it disagree on
 * the unobserved one: a peer that reported nothing is not a peer that reported offline.
 *
 * @param online - the presence record's own tri-state.
 * @returns the class suffix and the word the floor card prints.
 */
const onlineStatus = (
  online: boolean | undefined,
): { readonly cls: string; readonly word: string } =>
  Match.value(online).pipe(
    Match.when(true, () => ({ cls: "online", word: "online" })),
    Match.when(false, () => ({ cls: "offline", word: "offline" })),
    Match.orElse(() => ({ cls: "unknown", word: "observed" })),
  )

/** Render the factory state; every field comes from /presence. */
const factoryFloor = (
  h: Html.H<Message>,
  environments: ReadonlyArray<Environment>,
  tailnet: Tailnet | undefined,
  workstreams: ReadonlyArray<typeof Workstream.Type>,
  candidates: Readonly<Record<string, ReadonlyArray<Candidate>>>,
) => {
  if (environments.length === 0 && tailnet === undefined) return undefined
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
  return h.section.class("factory-floor").children(
    h.div
      .class("floor-head")
      .children(
        h.h2.children("Factory floor"),
        h.span
          .class("muted")
          .children(
            (tailnet === undefined || !tailnet.available
              ? "tailnet unavailable"
              : online + " online · " + machines.size + " machines") +
              " · " +
              environments.length +
              (environments.length === 1 ? " workstream" : " workstreams"),
          ),
      ),
    h.div.class("floor-grid").children(
      [...machines.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([host, machine]) =>
          h.div.class("floor-machine").children(
            h.div
              .class("floor-machine-head")
              .children(
                h.h3.children(host),
                h.span
                  .class("floor-status " + onlineStatus(machine.online).cls)
                  .children(onlineStatus(machine.online).word),
              ),
            ...(machine.entries.length === 0
              ? [h.span.class("muted").children("no workstream observed")]
              : machine.entries.map((environment) => {
                  const services = environment.services ?? []
                  const preview = environment.preview
                  const port = environment.port
                  const agent = environment.agent
                  const storedWorker = workstreams.find(
                    (entry) => entry.id === environment.workstream,
                  )?.worker
                  // A lane is a place the workstream could go, so the machine line counts them
                  // beside the workstream it belongs to instead of repeating every path.
                  const lanes = (candidates[environment.workstream] ?? []).filter(
                    (candidate) => candidate.state !== "dropped",
                  )
                  return h.div.class("floor-workstream").children(
                    h.a.attr("href", "#" + environment.workstream).children(environment.workstream),
                    h.span
                      .class("muted")
                      .children(
                        environment.runtime === undefined
                          ? "no runtime"
                          : environment.runtime.kind +
                              " · " +
                              environment.runtime.path.split("/").at(-1),
                      ),
                    port === null || port === undefined
                      ? services.length === 0
                        ? undefined
                        : h.span
                            .class("floor-service")
                            .children(
                              services
                                .map((service) => service.name + " · " + service.status)
                                .join(", "),
                            )
                      : h.span
                          .class("floor-service")
                          .children(
                            "port " + port.number,
                            ...(services.length === 0
                              ? []
                              : [
                                  " · ",
                                  services
                                    .map((service) => service.name + " · " + service.status)
                                    .join(", "),
                                ]),
                          ),
                    agent === null || agent === undefined
                      ? undefined
                      : h.span
                          .class("floor-service")
                          .children(
                            "agent " +
                              agent.session +
                              (agent.status === "" ? "" : " · " + agent.status),
                          ),
                    storedWorker === undefined
                      ? undefined
                      : h.span.class("floor-service").children("worker " + storedWorker),
                    lanes.length === 0
                      ? undefined
                      : h.span
                          .class("floor-service")
                          .children(
                            lanes.length +
                              (lanes.length === 1 ? " candidate lane" : " candidate lanes"),
                          ),
                    preview === null || preview === undefined
                      ? undefined
                      : h.a
                          .attr("href", preview)
                          .attr("target", "_blank")
                          .attr("rel", "noreferrer")
                          .children("preview " + preview),
                  )
                })),
          ),
        ),
    ),
  )
}

/**
 * The peers' environments, when the board serves /fleet.
 *
 * A peer that did not answer is drawn with its reason instead of being dropped: a floor that
 * hid an unreachable machine would read as a floor with fewer machines. A peer that answered
 * with no environment draws no row, because there is nothing there to name.
 */
const peerSection = (h: Html.H<Message>, fleet: Fleet | null | undefined) => {
  if (fleet === null || fleet === undefined) return undefined
  const peers = fleet.hosts.filter((host) => host.self !== true)
  if (peers.length === 0) return undefined
  const environments = fleet.environments
  return h.section.class("factory-floor peers").children(
    h.div
      .class("floor-head")
      .children(
        h.h2.children("Peers"),
        h.span
          .class("muted")
          .children(
            environments.length +
              (environments.length === 1 ? " environment" : " environments") +
              " · " +
              peers.length +
              (peers.length === 1 ? " peer" : " peers"),
          ),
      ),
    h.div.class("floor-grid").children(
      peers.map((peer) => {
        const served = environments.filter((entry) => entry.host === peer.host)
        return h.div.class("floor-machine").children(
          h.div
            .class("floor-machine-head")
            .children(
              h.h3.children(peer.host),
              h.span
                .class("floor-status " + (peer.ok ? "online" : "offline"))
                .children(peer.ok ? "reachable" : "no answer"),
            ),
          peer.ok || peer.error === null || peer.error === undefined
            ? undefined
            : h.span.class("muted").children(peer.error),
          served.length === 0
            ? h.span.class("muted").children(peer.ok ? "no workstream observed" : "not read")
            : undefined,
          ...served.map((entry) => {
            const preview = entry.preview
            const services = entry.services ?? []
            return h.div.class("floor-workstream").children(
              h.span.children(entry.host + " · " + entry.workstream),
              h.span
                .class("muted")
                .children(
                  entry.runtime === undefined
                    ? "no runtime"
                    : entry.runtime.kind + " · " + entry.runtime.path.split("/").at(-1),
                ),
              services.length === 0
                ? undefined
                : h.span
                    .class("floor-service")
                    .children(
                      services
                        .map((service) => "service " + service.name + " " + service.status)
                        .join(", "),
                    ),
              // A peer's preview is a path on that peer's own board, so it is drawn as text:
              // this page's origin would answer it, and the answer would not be the peer's.
              preview === null || preview === undefined
                ? undefined
                : h.span.class("floor-service").children("preview " + preview),
            )
          }),
        )
      }),
    ),
  )
}

/**
 * The room inventory the board serves under /presence.rooms.
 *
 * It is the observation surface for the rooms Alchemy can declare: the aggregate state and the
 * process the room owns, read from room.json and the run record. It does not invent a VM state;
 * the Environment line on a card names the runtime the board actually observed.
 */
const roomInventory = (h: Html.H<Message>, rooms: ReadonlyArray<Room>) =>
  card(h, {
    title: "Room inventory",
    id: "rooms",
    children: [
      h.p
        .class("muted")
        .children(
          "Rooms read from room.json. A machine that is not running leaves no process line.",
        ),
      ...rooms.map((room) =>
        h.div
          .class("package-meta")
          .children(
            h.span.class("mono").children(room.id),
            h.span.class("chip").children(room.state),
            room.process === null
              ? h.span.class("muted").children("no process")
              : h.span
                  .class("mono")
                  .children(
                    "pid " +
                      room.process.pid +
                      " · " +
                      (room.process.alive ? "alive" : "dead") +
                      (room.process.exec === undefined ? "" : " · " + room.process.exec),
                  ),
          ),
      ),
    ],
  })

const factoryPulse = (h: Html.H<Message>, presence: NonNullable<Model["presence"]>) => {
  const activities = presence.factory.activity
  const count = (state: typeof Activity.Type.state): number =>
    activities.filter((activity) => activity.state === state).length
  const desk = presence.factory.desk.length
  const stats = [
    { label: "working", value: count("working"), className: "working" },
    { label: "queued", value: count("queued"), className: "queued" },
    { label: "blocked", value: count("blocked"), className: "blocked" },
    { label: "needs you", value: desk, className: "desk" },
  ]
  return h.div
    .class("factory-pulse")
    .children(
      stats.map((stat) =>
        h.span
          .class("pulse-stat " + stat.className)
          .children(
            h.span.class("pulse-value").children(String(stat.value)),
            h.span.children(stat.label),
          ),
      ),
    )
}

const factoryView = (h: Html.H<Message>, model: Model) => {
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
  return h.div.class("shell").children(
    appHeader(h, { model, title: "Software factory", summary }),
    model.error === null
      ? undefined
      : h.p.class("error").children("Could not read /presence: " + model.error),
    model.notice === null ? undefined : h.p.class("notice").children(model.notice),
    presence === null ? undefined : factoryPulse(h, presence),
    presence === null || presence.rooms === undefined || presence.rooms.length === 0
      ? undefined
      : roomInventory(h, presence.rooms),
    presence === null || (presence.factory.workstreamIssues ?? []).length === 0
      ? undefined
      : card(h, {
          title: "Unreadable workstreams",
          id: "workstream-issues",
          children: (presence.factory.workstreamIssues ?? []).map((issue) =>
            h.div
              .class("error")
              .children(
                h.strong.children(issue.id),
                h.span.class("muted").children(" · " + issue.path),
                h.p.children(issue.detail),
              ),
          ),
        }),
    presence === null
      ? undefined
      : [
          factoryFloor(
            h,
            presence.factory.environments ?? [],
            presence.network?.tailscale,
            presence.factory.workstreams,
            candidatesByWorkstream(presence.factory.candidates),
          ),
          peerSection(h, model.fleet),
          ...Array.from(new Set(presence.factory.workstreams.map(repoName))).map((repo) =>
            repoSection(
              h,
              repo,
              presence.factory.workstreams.filter((ws) => repoName(ws) === repo),
              presence.factory.activity,
              [...presence.sessions.herdr.sessions, ...presence.sessions.rex.sessions],
              environmentsByWorkstream(presence.factory.environments),
              candidatesByWorkstream(presence.factory.candidates),
            ),
          ),
          presence.factory.desk.length === 0
            ? undefined
            : card(h, {
                title: "Needs you",
                children: presence.factory.desk.map((item) => deskRow(h, item)),
                id: "desk",
              }),
          presence.factory.reports.length === 0
            ? undefined
            : h.details
                .class("card reports-card")
                .children(
                  h.summary.children("Reports (" + presence.factory.reports.length + ")"),
                  ...presence.factory.reports.map((item) => reportRow(h, item)),
                ),
        ],
  )
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
    note: "The board's Effect UI client. It reads /presence and /atlas; it imports neither.",
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

const chip = (h: Html.H<Message>, text: string) => h.span.class("chip").children(text)

const atlasPackageCard = (
  h: Html.H<Message>,
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
  return h.div
    .class("package-card")
    .children(
      h.div
        .class("package-head")
        .children(
          h.h3.children(h.a.attr("href", githubUrl(entry.path)).children(shortName(entry.name))),
          h.span.class("package-version").children(entry.version ?? "0.0.0"),
        ),
      entry.description === undefined || entry.description === ""
        ? undefined
        : h.p.class("package-description").children(entry.description),
      showSummary ? h.p.class("package-summary").children(summary) : undefined,
      h.div
        .class("package-meta")
        .children(
          h.span.class("mono").children(entry.path),
          entry.private === true ? chip(h, "private") : chip(h, "published"),
          ...(entry.scripts ?? []).slice(0, 4).map((script) => chip(h, script)),
        ),
      h.div
        .class("package-deps")
        .children(
          dependencies.length === 0
            ? h.span.class("muted").children("no workspace dependencies")
            : [
                h.span.class("muted").children("depends on"),
                ...dependencies.map((dependency) => chip(h, shortName(dependency))),
              ],
        ),
      usedBy.length === 0
        ? undefined
        : h.div
            .class("package-deps")
            .children(
              h.span.class("muted").children("used by"),
              ...usedBy.map((name) => chip(h, name)),
            ),
    )
}

const atlasLayer = (
  h: Html.H<Message>,
  layer: AtlasLayer,
  packages: ReadonlyArray<AtlasPackage>,
  edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
) =>
  packages.length === 0
    ? undefined
    : h.section
        .attr("id", layer.id)
        .class("atlas-layer")
        .children(
          h.div
            .class("atlas-layer-head")
            .children(
              h.h2.children(layer.title),
              h.span.class("count").children(String(packages.length)),
            ),
          h.p.class("atlas-layer-note").children(layer.note),
          h.div
            .class("package-grid")
            .children(packages.map((entry) => atlasPackageCard(h, entry, edges))),
        )

const atlasView = (h: Html.H<Message>, model: Model) => {
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
  return h.div.class("shell").children(
    appHeader(h, { model, title: "Tackle", summary }),
    model.error === null
      ? undefined
      : h.p.class("error").children("Could not read /atlas: " + model.error),
    atlas === null
      ? undefined
      : [
          card(h, {
            title: "What this is",
            children: [
              h.p.children(
                "The workspace is a set of small tools that agree on formats, not a monolith. " +
                  "The seam is @autotelic/protocol; everything else is a role that reads or writes a format.",
              ),
              h.p
                .class("muted")
                .children(
                  "Every card is read from its package.json and README at request time. " +
                    "The dependency chips are workspace edges; external packages are deliberately left out.",
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
          other.length === 0
            ? undefined
            : atlasLayer(
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
        ],
  )
}
