import { Match } from "effect"
import type { View } from "@effect/ui"
import { Html } from "@effect/ui/html"

import { Message, type Model } from "./main.ts"

/*
 * A map, not a second projection of state. The scenes borrow their spatial grammar from
 * the linked posts: a place with zones, an orbit with a focused stage, a browser over a
 * host, a feedback cycle, and a horizon. The live facts stay on /factory and /tackle.
 */

/** One message the map can draw: the type the helpers thread through `h`. */
type Content = View.Input<Message>

/** The three status words; the page's whole tone vocabulary. */
type Tone = "built" | "missing"
/** The two preview routes the browser scene can focus. */
type Focus = "permissions" | "enterprise"

interface Stage {
  readonly title: string
  readonly detail: string
  readonly tone: Tone
}

const STAGES: ReadonlyArray<Stage> = [
  { title: "project", detail: "Linear project + issue tree", tone: "missing" },
  { title: "adopt", detail: "workstream, branch, PR, worker", tone: "built" },
  { title: "daemon", detail: "one waking event per pass; restart-safe", tone: "built" },
  { title: "worker", detail: "Pi · low thinking · Herdr", tone: "built" },
  { title: "provider", detail: "local worktree / embedded agentOS VM", tone: "built" },
  { title: "receipt", detail: "quality + check events + handoff", tone: "built" },
]

const stageClass = (input: {
  readonly index: number
  readonly active: number
}): ReadonlyArray<string> => [
  "orbit-node",
  "orbit-" + input.index,
  input.index === input.active ? "active" : "",
  input.index < input.active ? "done" : "",
]

const stageNode = (
  h: Html.H<Message>,
  input: { readonly stage: Stage; readonly index: number; readonly active: number },
) =>
  h.button
    .class(...stageClass({ index: input.index, active: input.active }))
    .on("click", Message.VisionStep({ step: input.index }))
    .children(
      h.span.class("node-kicker").children(String(input.index + 1).padStart(2, "0")),
      h.span.class("node-title").children(input.stage.title),
      h.span.class("node-detail").children(input.stage.detail),
    )

const badge = (h: Html.H<Message>, tone: Tone) =>
  h.span.class("scene-badge " + tone).children(
    Match.value(tone).pipe(
      Match.when("built", () => "WORKS"),
      Match.when("missing", () => "NOT BUILT"),
      Match.exhaustive,
    ),
  )

interface TailnetMachine {
  readonly id: string
  readonly label: string
  readonly subtitle: string
  readonly contacts: ReadonlyArray<string>
  readonly workstreams: ReadonlyArray<{ readonly name: string; readonly service: string }>
  readonly kind: "machine" | "phone"
}

const TAILNET_MACHINES: ReadonlyArray<TailnetMachine> = [
  {
    id: "mbp1",
    label: "MacBook Pro 1",
    subtitle: "shop · board · factory UI",
    contacts: ["Herdr", "board", "factory UI"],
    workstreams: [
      { name: "permissions-1862", service: "web :4400 · healthy" },
      { name: "enterprise-1854", service: "web :4401 · healthy" },
    ],
    kind: "machine",
  },
  {
    id: "mbp2",
    label: "MacBook Pro 2",
    subtitle: "Herdr + Rex",
    contacts: ["Herdr", "Rex"],
    workstreams: [{ name: "tackle-factory", service: "trunk · daemon · preview" }],
    kind: "machine",
  },
  {
    id: "mbp3",
    label: "MacBook Pro 3",
    subtitle: "Herdr + Rex",
    contacts: ["Herdr", "Rex"],
    workstreams: [{ name: "factory-view", service: "web :4402 · review" }],
    kind: "machine",
  },
  {
    id: "mini",
    label: "Mac mini",
    subtitle: "always-on shop",
    contacts: ["board daemon", "records", "mailbox"],
    workstreams: [{ name: "durable source", service: "no service · always on" }],
    kind: "machine",
  },
  {
    id: "phoneA",
    label: "Phone A",
    subtitle: "Herdr",
    contacts: ["Herdr"],
    workstreams: [],
    kind: "phone",
  },
  {
    id: "phoneB",
    label: "Phone B",
    subtitle: "Rex",
    contacts: ["Rex"],
    workstreams: [],
    kind: "phone",
  },
]

const mapMachine = (h: Html.H<Message>, machine: TailnetMachine, selected: string) =>
  h.button
    .class("rack-machine rack-" + machine.id, machine.id === selected && "selected")
    .on("click", Message.VisionMachine({ machine: machine.id }))
    .children(
      h.span.class("map-machine-title").children(machine.label),
      h.span.class("map-machine-sub").children(machine.subtitle),
      h.div
        .class("map-contacts")
        .children(machine.contacts.map((contact) => h.span.class("map-contact").children(contact))),
      h.div
        .class("map-workstreams")
        .children(
          machine.workstreams.map((workstream) =>
            h.span
              .class("map-workstream")
              .children(
                h.span.class("map-workstream-name").children(workstream.name),
                h.span.class("map-workstream-service").children(workstream.service),
              ),
          ),
        ),
    )

const tailnetMap = (h: Html.H<Message>, selected: string) => {
  const machine = TAILNET_MACHINES.find((entry) => entry.id === selected) ?? TAILNET_MACHINES[0]!
  return h.div
    .class("tailnet-wrap")
    .children(
      h.div
        .class("map-scroll")
        .children(
          h.div
            .class("tailnet-rack")
            .children(
              h.div
                .class("rack-services")
                .children(
                  h.span.class("rack-label").children("OUTSIDE THE TAILNET"),
                  h.span.class("rack-service").children("Linear"),
                  h.span.class("rack-service").children("GitHub"),
                  h.span.class("rack-service").children("Slack"),
                ),
              h.div
                .class("rack-bus")
                .children(
                  h.span.class("rack-bus-label").children("TAILNET · taila38bf7.ts.net"),
                  h.span.class("rack-bus-line"),
                ),
              h.div
                .class("rack-machines")
                .children(
                  TAILNET_MACHINES.filter((entry) => entry.kind === "machine").map((entry) =>
                    mapMachine(h, entry, selected),
                  ),
                ),
              h.div
                .class("rack-phones")
                .children(
                  h.span.class("rack-label").children("CONTACT SURFACES"),
                  ...TAILNET_MACHINES.filter((entry) => entry.kind === "phone").map((entry) =>
                    mapMachine(h, entry, selected),
                  ),
                ),
            ),
        ),
      h.div
        .class("map-focus")
        .children(
          h.span
            .class("node-kicker")
            .children(machine.kind === "phone" ? "CONTACT SURFACE" : "MACHINE"),
          h.h3.children(machine.label),
          h.p.children(machine.subtitle),
          h.div
            .class("map-focus-grid")
            .children(
              h.div
                .class("map-focus-contacts")
                .children(
                  h.span.class("map-focus-label").children("running here"),
                  ...machine.contacts.map((contact) =>
                    h.span.class("map-contact").children(contact),
                  ),
                ),
              h.div
                .class("map-focus-workstreams")
                .children(
                  h.span.class("map-focus-label").children("workstreams"),
                  ...(machine.workstreams.length === 0
                    ? [h.span.class("muted").children("contact surface only")]
                    : machine.workstreams.map((workstream) =>
                        h.span
                          .class("map-workstream")
                          .children(
                            h.span.class("map-workstream-name").children(workstream.name),
                            h.span.class("map-workstream-service").children(workstream.service),
                          ),
                      )),
                ),
            ),
        ),
    )
}

const sceneHeader = (
  h: Html.H<Message>,
  input: { readonly title: string; readonly caption: string },
) => h.div.class("scene-head").children(h.h2.children(input.title), h.p.children(input.caption))

const focusNode = (h: Html.H<Message>, input: { readonly focus: Focus; readonly active: Focus }) =>
  h.button
    .class("tab", input.focus === input.active && "active")
    .on("click", Message.VisionFocus({ focus: input.focus }))
    .children(
      h.span.class("tab-title").children(input.focus === "permissions" ? "Tab 1" : "Tab 2"),
      h.span
        .class("tab-route")
        .children(input.focus === "permissions" ? "permissions-1862" : "enterprise-1854"),
    )

const machine = (
  h: Html.H<Message>,
  input: { readonly title: string; readonly detail: string; readonly zone: string },
) =>
  h.div
    .class("machine " + input.zone)
    .children(
      h.span.class("machine-title").children(input.title),
      h.span.class("machine-detail").children(input.detail),
    )

const room = (
  h: Html.H<Message>,
  input: { readonly title: string; readonly detail: string; readonly active: boolean },
) =>
  h.div
    .class("room-bench", input.active && "active")
    .children(
      h.span.class("room-title").children(input.title),
      h.span.class("room-detail").children(input.detail),
    )

const cycleNode = (
  h: Html.H<Message>,
  input: { readonly title: string; readonly detail: string; readonly zone: string },
) =>
  h.div
    .class("cycle-node " + input.zone)
    .children(
      h.span.class("node-title").children(input.title),
      h.span.class("node-detail").children(input.detail),
    )

const horizonItem = (
  h: Html.H<Message>,
  input: { readonly tone: Tone; readonly title: string; readonly detail: string },
) =>
  h.div
    .class("horizon-item " + input.tone)
    .children(
      badge(h, input.tone),
      h.span.class("node-title").children(input.title),
      h.span.class("node-detail").children(input.detail),
    )

/** One labelled row of the Erlang comparison table. */
const generationRow = (h: Html.H<Message>, row: ReadonlyArray<string>) =>
  h.div
    .class("generation-row")
    .children(h.span.class("generation-term").children(row[0] ?? ""), h.span.children(row[1] ?? ""))

/**
 * Render the vision map: the place, the substrate seam, the tailnet, one workstream's orbit,
 * the browser over two preview routes, the feedback cycle, and the horizon.
 *
 * @param model - the selected stage, the focused preview route, and the selected machine.
 * @param h - the HTML builder the page is assembled with.
 * @returns the /vision document body.
 */
export const visionView = (h: Html.H<Message>, model: Model) => {
  const active = Math.min(Math.max(model.visionStep ?? 0, 0), STAGES.length - 1)
  const focus = model.visionFocus ?? "permissions"
  const stage = STAGES[active] ?? STAGES[0]!
  const steps: ReadonlyArray<ReadonlyArray<string>> = [
    ["Promoted generation", "git sha, schema version, launcher; only a promoted ref is eligible"],
    ["Drain", "stop dispatch, wait live passes, release pass/shop locks, exit"],
    ["Handoff", "start new process, health check, take shop.lock; next pass runs new code"],
    ["Rollback", "if health fails, start the previous generation; never run two owners"],
  ]
  const erlang: ReadonlyArray<ReadonlyArray<string>> = [
    ["supervisor", "one owner; restart strategy"],
    ["code_change/3", "workstream/receipt schema migration"],
    ["release_handler / appup", "generation descriptor + drain + health"],
    ["sys:suspend → change_code → resume", "drain → handoff → new owner"],
    ["two module versions", "not in Node; old and new processes, never mixed"],
  ]
  const scenes: ReadonlyArray<Content> = [
    h.section.class("vision-scene").children(
      sceneHeader(h, {
        title: "Current state",
        caption: "A dated snapshot, not a live feed. /factory and /presence are the live readings.",
      }),
      h.div.class("horizon-stack").children(
        h.div.class("horizon-layer today").children(
          h.span.class("horizon-title").children("27 Nov 2026"),
          horizonItem(h, {
            tone: "built",
            title: "main",
            detail: "room + board green · Room/RoomMachine apply tests",
          }),
          horizonItem(h, {
            tone: "built",
            title: "factory loop",
            detail: "check events · quality follow-up · ready + merge retirement",
          }),
          horizonItem(h, {
            tone: "built",
            title: "agentOS",
            detail: "embedded VM · own filesystem/process · no Rivet credentials",
          }),
          horizonItem(h, {
            tone: "built",
            title: "Alchemy inventory",
            detail: "Worker + Room DO · Tackle.Room / RoomMachine · plan + apply tests",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "two-project launch",
            detail: "runbook ready · blocked on target gate decision",
          }),
        ),
      ),
    ),
    h.section.class("vision-scene shop-scene").children(
      sceneHeader(h, {
        title: "The factory is a place",
        caption:
          "board is the control plane. Alchemy is the inventory. room is the bench. protocol is the floor they stand on.",
      }),
      h.div.class("shop-floor").children(
        machine(h, { title: "you + Pi", detail: "Herdr terminal", zone: "human-zone" }),
        machine(h, {
          title: "board",
          detail: "factory kernel · daemon · queue · Alchemy stack",
          zone: "board-zone",
        }),
        h.div
          .class("seam-zone")
          .children(
            h.span.class("seam-title").children("protocol"),
            h.span.class("seam-detail").children("formats + mailbox decisions · no runtime"),
          ),
        machine(h, {
          title: "room A",
          detail: "worktree · process · port · service",
          zone: "room-zone room-a",
        }),
        machine(h, {
          title: "room B",
          detail: "another worktree · another service",
          zone: "room-zone room-b",
        }),
      ),
    ),
    h.section.class("vision-scene substrate-scene").children(
      sceneHeader(h, {
        title: "Alchemy declares the inventory",
        caption:
          "Alchemy owns what must exist. Room owns the record and its runtime. agentOS owns the machine. The same desired state can point at this tailnet, a Fly app, or another provider later.",
      }),
      h.div.class("substrate-map").children(
        h.div.class("substrate-local").children(
          h.span.class("zone-label local-label").children("TODAY · TAILNET"),
          machine(h, {
            title: "Board",
            detail: "Worker · Room Durable Objects",
            zone: "local-node",
          }),
          machine(h, {
            title: "Room",
            detail: "Tackle.Room · worktree · room.json",
            zone: "local-node",
          }),
          machine(h, {
            title: "RoomMachine",
            detail: "VM supervisor · start / read / stop",
            zone: "local-node",
          }),
        ),
        h.div
          .class("substrate-core")
          .children(
            h.span.class("zone-label").children("ALCHEMY"),
            h.span.class("substrate-title").children("desired state"),
            h.span.class("substrate-detail").children("providers, not a place"),
            h.span.class("provider-chip").children("Stack"),
            h.span.class("provider-chip").children("Room"),
            h.span.class("provider-chip").children("RoomMachine"),
            h.span.class("provider-chip").children("Cloudflare"),
          ),
        h.div.class("substrate-later").children(
          h.span.class("zone-label cloud-label").children("LATER · OPTIONAL"),
          machine(h, {
            title: "control plane",
            detail: "same entities, hosted",
            zone: "cloud-node",
          }),
          machine(h, {
            title: "rooms",
            detail: "same bench contract",
            zone: "cloud-node",
          }),
          machine(h, { title: "mailbox", detail: "stays private", zone: "cloud-node" }),
        ),
      ),
      h.div
        .class("substrate-note")
        .children(
          "The board stack plans the Worker and Room Durable Objects. Tackle.Room and Tackle.RoomMachine are a library: a stack composes them when it has a real room. A room's worktree is retained on delete; a machine's supervisor is stopped. No cloud migration yet.",
        ),
    ),
    h.section.class("vision-scene").children(
      sceneHeader(h, {
        title: "How to observe the inventory",
        caption:
          "Three different facts, three different readings. Do not use one as proof of another.",
      }),
      h.div.class("horizon-stack").children(
        h.div.class("horizon-layer today").children(
          h.span.class("horizon-title").children("live / planned / proven"),
          horizonItem(h, {
            tone: "built",
            title: "/factory · Room inventory",
            detail:
              "room.json state + process the room owns; the Environment line names runtime, port and service",
          }),
          horizonItem(h, {
            tone: "built",
            title: "alchemy plan",
            detail:
              "the stack graph: BoardWorker + Room Durable Objects; compose Tackle.Room / RoomMachine for a real room",
          }),
          horizonItem(h, {
            tone: "built",
            title: "board tests",
            detail:
              "alchemy-room-plan proves the graph; alchemy-room-apply creates a scratch room/worktree and starts the supervisor",
          }),
        ),
      ),
    ),
    h.section.class("vision-scene network-scene").children(
      sceneHeader(h, {
        title: "The tailnet is the intranet",
        caption:
          "The rack the loop is designed around. Live sessions and services are on /factory; this map does not invent them.",
      }),
      tailnetMap(h, model.visionMachine ?? "mbp1"),
    ),
    h.section.class("vision-scene orbit-scene").children(
      sceneHeader(h, {
        title: "One workstream is an orbit",
        caption: "the stage you select becomes the center of gravity",
      }),
      h.div
        .class("orbit")
        .children(
          ...STAGES.map((entry, index) => stageNode(h, { stage: entry, index, active })),
          h.div
            .class("orbit-center")
            .children(
              h.span.class("node-kicker").children("STEP " + String(active + 1).padStart(2, "0")),
              h.h3.children(stage.title),
              h.p.children(stage.detail),
              h.div
                .class("orbit-controls")
                .children(
                  h.button
                    .on("click", Message.VisionStep({ step: Math.max(0, active - 1) }))
                    .children("Previous"),
                  h.button
                    .on("click", Message.VisionNext())
                    .children(active === STAGES.length - 1 ? "Restart" : "Next"),
                  h.button.on("click", Message.VisionReset()).children("Reset"),
                ),
            ),
        ),
    ),
    h.section.class("vision-scene shakti-scene").children(
      sceneHeader(h, {
        title: "Two Shakti apps on the tailnet",
        caption: "the tabs are real; the rooms isolate the checkout, not the host",
      }),
      h.div
        .class("browser")
        .children(
          h.div
            .class("browser-bar")
            .children(
              h.span.children("● ● ●"),
              h.span
                .class("browser-address")
                .children(
                  focus === "permissions" ? "preview/permissions-1862" : "preview/enterprise-1854",
                ),
            ),
          h.div
            .class("browser-tabs")
            .children(
              focusNode(h, { focus: "permissions", active: focus }),
              focusNode(h, { focus: "enterprise", active: focus }),
            ),
          h.div
            .class("browser-page")
            .children(
              h.span
                .class("preview-title")
                .children(
                  focus === "permissions" ? "Permissions overhaul" : "Enterprise readiness",
                ),
              h.span.class("muted").children("same browser · same origin · two preview routes"),
            ),
        ),
      h.div.class("host-boundary").children(
        h.div.class("room-row").children(
          room(h, {
            title: "room A",
            detail: "worktree · :4400 · web",
            active: focus === "permissions",
          }),
          room(h, {
            title: "room B",
            detail: "worktree · :4401 · web",
            active: focus === "enterprise",
          }),
        ),
        h.div
          .class("isolation-warning")
          .children(
            "Local rooms isolate worktrees, branches, ports, services, and previews. They do not isolate the OS: both still share the host filesystem, network namespace, and processes. The agentOS provider is the prototype for that wall.",
          ),
      ),
    ),
    h.section.class("vision-scene cycle-scene").children(
      sceneHeader(h, {
        title: "Feedback comes back",
        caption: "a review or check enters at the edge; the next pass leaves from the center",
      }),
      h.div.class("feedback-cycle").children(
        cycleNode(h, {
          title: "review / check",
          detail: "GitHub review, comment, or check",
          zone: "cycle-review",
        }),
        cycleNode(h, { title: "event", detail: "cursor advances", zone: "cycle-event" }),
        cycleNode(h, { title: "pass", detail: "worker addresses it", zone: "cycle-pass" }),
        cycleNode(h, { title: "commit", detail: "pushed to the PR", zone: "cycle-commit" }),
        cycleNode(h, {
          title: "receipt",
          detail: "next cursor + evidence",
          zone: "cycle-receipt",
        }),
        h.div
          .class("cycle-center")
          .children(
            h.span.class("cycle-title").children("the loop owns the work"),
            h.span
              .class("muted")
              .children(
                "check pass, quality follow-up, ready handoff; outbound labels/comments stay manual",
              ),
          ),
      ),
    ),
    h.section.class("vision-scene").children(
      sceneHeader(h, {
        title: "The technology seam",
        caption:
          "The linked set, decided for this milestone. No dependency was added where the local seam already exists.",
      }),
      h.div.class("horizon-stack").children(
        h.div.class("horizon-layer today").children(
          h.span.class("horizon-title").children("adopted / prototyped"),
          horizonItem(h, {
            tone: "built",
            title: "Alchemy",
            detail: "Worker + Room DO · Tackle.Room / RoomMachine · plan + apply tests",
          }),
          horizonItem(h, {
            tone: "built",
            title: "agentOS",
            detail: "adopted · embedded core · own VM per room",
          }),
        ),
        h.div.class("horizon-layer next").children(
          h.span.class("horizon-title").children("deferred / rejected"),
          horizonItem(h, {
            tone: "missing",
            title: "rivet-effect-cluster",
            detail: "deferred · existing lock + journal hold two local projects",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "rat-king",
            detail: "rejected this milestone · pre-alpha · mailbox/intercom remains",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "talkto",
            detail: "rejected this milestone · private hosted app · desk remains",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "orb lifecycle",
            detail: "spawn / pause / delete provider contract; borrowed from Amp",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "Executor",
            detail: "evaluated · gateway/catalog/credentials · not the authority",
          }),
        ),
      ),
    ),
    h.section.class("vision-scene").children(
      sceneHeader(h, {
        title: "Executor is a gateway, not the authority",
        caption:
          "The catalog, credential and policy plane. A missing capability is a startup failure, not a browser fallback.",
      }),
      h.div.class("horizon-stack").children(
        h.div.class("horizon-layer today").children(
          h.span.class("horizon-title").children("today"),
          horizonItem(h, {
            tone: "built",
            title: "room tools",
            detail: "host MCP config + prompt; a missing Linear tool can become browse",
          }),
        ),
        h.div.class("horizon-layer next").children(
          h.span.class("horizon-title").children("next"),
          horizonItem(h, {
            tone: "missing",
            title: "capability manifest",
            detail: "required linear.read.document; resolve before the worker starts",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "Executor gateway",
            detail: "one catalog · scoped Linear token · allow / approve / block",
          }),
        ),
        h.div.class("horizon-layer target").children(
          h.span.class("horizon-title").children("target"),
          horizonItem(h, {
            tone: "missing",
            title: "room requires · Executor resolves",
            detail: "fail closed; browse is app-origin only",
          }),
        ),
      ),
    ),
    h.section.class("vision-scene generation-scene").children(
      sceneHeader(h, {
        title: "A generation hands off; it does not patch itself",
        caption:
          "Node cannot safely unload a live module. The unit of update is a generation, and the handoff is the protocol.",
      }),
      h.div
        .class("generation-flow")
        .children(
          h.div
            .class("generation-lane old")
            .children(
              h.span.class("generation-kicker").children("OLD GENERATION"),
              h.strong.children("daemon"),
              h.span.children("draining · no new passes"),
            ),
          h.div.class("generation-arrow").children("wait live passes"),
          h.div
            .class("generation-lane supervisor")
            .children(
              h.span.class("generation-kicker").children("SUPERVISOR"),
              h.strong.children("one owner"),
              h.span.children("start · drain · health · rollback"),
            ),
          h.div.class("generation-arrow").children("health check"),
          h.div
            .class("generation-lane new")
            .children(
              h.span.class("generation-kicker").children("NEW GENERATION"),
              h.strong.children("daemon + board"),
              h.span.children("owns shop.lock · next pass"),
            ),
        ),
      h.div
        .class("generation-steps")
        .children(
          steps.map((step, index) =>
            h.div
              .class("generation-step")
              .children(
                h.span.class("generation-number").children(String(index + 1).padStart(2, "0")),
                h.strong.children(step[0] ?? ""),
                h.span.children(step[1] ?? ""),
              ),
          ),
        ),
      h.div
        .class("generation-erlang")
        .children(
          h.h3.children("What Erlang taught us"),
          h.p.children(
            "The BEAM can hold two module versions and call code_change/3 on a live process. We borrow the protocol, not the trick: one supervisor, an explicit handoff, and a state migration.",
          ),
          h.div.class("generation-table").children(erlang.map((row) => generationRow(h, row))),
        ),
    ),
    h.section.class("vision-scene horizon-scene").children(
      sceneHeader(h, {
        title: "The horizon",
        caption: "local rooms work; embedded agentOS adds the VM wall",
      }),
      h.div.class("horizon-stack").children(
        h.div.class("horizon-layer today").children(
          h.span.class("horizon-title").children("today"),
          horizonItem(h, {
            tone: "built",
            title: "directory",
            detail: "worktree + process + port",
          }),
          horizonItem(h, {
            tone: "built",
            title: "room",
            detail: "one service · one port · one preview · isolated checkout",
          }),
          horizonItem(h, {
            tone: "built",
            title: "Alchemy inventory",
            detail: "Room + RoomMachine declarations · plan and apply tested",
          }),
        ),
        h.div.class("horizon-layer next").children(
          h.span.class("horizon-title").children("next"),
          horizonItem(h, {
            tone: "built",
            title: "agentOS provider",
            detail: "embedded VM per room · separate filesystem and process",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "agentOS preview bridge",
            detail: "next: board route → VM network.preview; host ports until then",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "container",
            detail: "deferred: directory now; Docker/agentOS after the loop",
          }),
        ),
        h.div.class("horizon-layer target").children(
          h.span.class("horizon-title").children("target"),
          horizonItem(h, {
            tone: "built",
            title: "agentOS",
            detail: "embedded VM · own filesystem and process · local host",
          }),
        ),
        h.div.class("horizon-outside").children(
          horizonItem(h, {
            tone: "built",
            title: "Linear dependencies",
            detail: "events, not a queue gate",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "telemetry / Slack",
            detail: "no listener or product-context feed",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "Rat King transport",
            detail: "pre-alpha; rejected for this milestone; mailbox/intercom remains",
          }),
          horizonItem(h, {
            tone: "missing",
            title: "TalkTo surface",
            detail: "private hosted app; rejected for this milestone; desk remains",
          }),
        ),
      ),
    ),
  ]
  return h.div
    .class("shell vision-shell")
    .children(
      h.header
        .class("header")
        .children(
          h.div.children(
            h.h1.children("How the factory moves"),
            h.span
              .class("muted")
              .children("the loop, the isolation boundary, the technology seam, and the horizon"),
            h.div
              .class("nav")
              .children(
                h.a.attr("href", "/").children("Factory"),
                h.a.attr("href", "/tackle").children("Tackle"),
                h.a.class("active").attr("href", "/vision").children("Vision"),
              ),
          ),
        ),
      h.div
        .class("scene-legend")
        .children(
          h.span.class("scene-badge built").children("WORKS"),
          h.span.class("scene-badge missing").children("NOT BUILT"),
          h.span.class("muted").children("color is status; position is role"),
        ),
      ...scenes,
    )
}
