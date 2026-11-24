import { Match } from "effect"
import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { Message, type Model } from "./main.ts"

/*
 * A map, not a second projection of state. The scenes borrow their spatial grammar from
 * the linked posts: a place with zones, an orbit with a focused stage, a browser over a
 * host, a feedback cycle, and a horizon. The live facts stay on /factory and /tackle.
 */

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

const stageClass = (input: { readonly index: number; readonly active: number }): string =>
  "orbit-node orbit-" +
  input.index +
  (input.index === input.active ? " active" : input.index < input.active ? " done" : "")

const stageNode = (
  h: HtmlBuilder<Message>,
  input: { readonly stage: Stage; readonly index: number; readonly active: number },
): Html =>
  h.button(
    [
      h.Class(stageClass({ index: input.index, active: input.active })),
      h.OnClick(Message.VisionStep({ step: input.index })),
    ],
    [
      h.span([h.Class("node-kicker")], [String(input.index + 1).padStart(2, "0")]),
      h.span([h.Class("node-title")], [input.stage.title]),
      h.span([h.Class("node-detail")], [input.stage.detail]),
    ],
  )

const badge = (h: HtmlBuilder<Message>, tone: Tone): Html =>
  h.span(
    [h.Class("scene-badge " + tone)],
    [
      Match.value(tone).pipe(
        Match.when("built", () => "WORKS"),
        Match.when("missing", () => "NOT BUILT"),
        Match.exhaustive,
      ),
    ],
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

const mapMachine = (h: HtmlBuilder<Message>, machine: TailnetMachine, selected: string) =>
  h.button(
    [
      h.Class("rack-machine rack-" + machine.id + (machine.id === selected ? " selected" : "")),
      h.OnClick(Message.VisionMachine({ machine: machine.id })),
    ],
    [
      h.span([h.Class("map-machine-title")], [machine.label]),
      h.span([h.Class("map-machine-sub")], [machine.subtitle]),
      h.div(
        [h.Class("map-contacts")],
        machine.contacts.map((contact) => h.span([h.Class("map-contact")], [contact])),
      ),
      h.div(
        [h.Class("map-workstreams")],
        machine.workstreams.map((workstream) =>
          h.span(
            [h.Class("map-workstream")],
            [
              h.span([h.Class("map-workstream-name")], [workstream.name]),
              h.span([h.Class("map-workstream-service")], [workstream.service]),
            ],
          ),
        ),
      ),
    ],
  )

const tailnetMap = (h: HtmlBuilder<Message>, selected: string) => {
  const machine = TAILNET_MACHINES.find((entry) => entry.id === selected) ?? TAILNET_MACHINES[0]!
  return h.div(
    [h.Class("tailnet-wrap")],
    [
      h.div(
        [h.Class("map-scroll")],
        [
          h.div(
            [h.Class("tailnet-rack")],
            [
              h.div(
                [h.Class("rack-services")],
                [
                  h.span([h.Class("rack-label")], ["OUTSIDE THE TAILNET"]),
                  h.span([h.Class("rack-service")], ["Linear"]),
                  h.span([h.Class("rack-service")], ["GitHub"]),
                  h.span([h.Class("rack-service")], ["Slack"]),
                ],
              ),
              h.div(
                [h.Class("rack-bus")],
                [
                  h.span([h.Class("rack-bus-label")], ["TAILNET · taila38bf7.ts.net"]),
                  h.span([h.Class("rack-bus-line")], []),
                ],
              ),
              h.div(
                [h.Class("rack-machines")],
                TAILNET_MACHINES.filter((entry) => entry.kind === "machine").map((entry) =>
                  mapMachine(h, entry, selected),
                ),
              ),
              h.div(
                [h.Class("rack-phones")],
                [
                  h.span([h.Class("rack-label")], ["CONTACT SURFACES"]),
                  ...TAILNET_MACHINES.filter((entry) => entry.kind === "phone").map((entry) =>
                    mapMachine(h, entry, selected),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
      h.div(
        [h.Class("map-focus")],
        [
          h.span(
            [h.Class("node-kicker")],
            [machine.kind === "phone" ? "CONTACT SURFACE" : "MACHINE"],
          ),
          h.h3([], [machine.label]),
          h.p([], [machine.subtitle]),
          h.div(
            [h.Class("map-focus-grid")],
            [
              h.div(
                [h.Class("map-focus-contacts")],
                [
                  h.span([h.Class("map-focus-label")], ["running here"]),
                  ...machine.contacts.map((contact) => h.span([h.Class("map-contact")], [contact])),
                ],
              ),
              h.div(
                [h.Class("map-focus-workstreams")],
                [
                  h.span([h.Class("map-focus-label")], ["workstreams"]),
                  ...(machine.workstreams.length === 0
                    ? [h.span([h.Class("muted")], ["contact surface only"])]
                    : machine.workstreams.map((workstream) =>
                        h.span(
                          [h.Class("map-workstream")],
                          [
                            h.span([h.Class("map-workstream-name")], [workstream.name]),
                            h.span([h.Class("map-workstream-service")], [workstream.service]),
                          ],
                        ),
                      )),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const sceneHeader = (
  h: HtmlBuilder<Message>,
  input: { readonly title: string; readonly caption: string },
): Html => h.div([h.Class("scene-head")], [h.h2([], [input.title]), h.p([], [input.caption])])

const focusNode = (
  h: HtmlBuilder<Message>,
  input: { readonly focus: Focus; readonly active: Focus },
): Html =>
  h.button(
    [
      h.Class("tab" + (input.focus === input.active ? " active" : "")),
      h.OnClick(Message.VisionFocus({ focus: input.focus })),
    ],
    [
      h.span([h.Class("tab-title")], [input.focus === "permissions" ? "Tab 1" : "Tab 2"]),
      h.span(
        [h.Class("tab-route")],
        [input.focus === "permissions" ? "permissions-1862" : "enterprise-1854"],
      ),
    ],
  )

const machine = (
  h: HtmlBuilder<Message>,
  input: { readonly title: string; readonly detail: string; readonly zone: string },
): Html =>
  h.div(
    [h.Class("machine " + input.zone)],
    [
      h.span([h.Class("machine-title")], [input.title]),
      h.span([h.Class("machine-detail")], [input.detail]),
    ],
  )

const room = (
  h: HtmlBuilder<Message>,
  input: { readonly title: string; readonly detail: string; readonly active: boolean },
): Html =>
  h.div(
    [h.Class("room-bench" + (input.active ? " active" : ""))],
    [
      h.span([h.Class("room-title")], [input.title]),
      h.span([h.Class("room-detail")], [input.detail]),
    ],
  )

const cycleNode = (
  h: HtmlBuilder<Message>,
  input: { readonly title: string; readonly detail: string; readonly zone: string },
): Html =>
  h.div(
    [h.Class("cycle-node " + input.zone)],
    [
      h.span([h.Class("node-title")], [input.title]),
      h.span([h.Class("node-detail")], [input.detail]),
    ],
  )

const horizonItem = (
  h: HtmlBuilder<Message>,
  input: { readonly tone: Tone; readonly title: string; readonly detail: string },
): Html =>
  h.div(
    [h.Class("horizon-item " + input.tone)],
    [
      badge(h, input.tone),
      h.span([h.Class("node-title")], [input.title]),
      h.span([h.Class("node-detail")], [input.detail]),
    ],
  )

/**
 * Render the vision map: the place, the substrate seam, the tailnet, one workstream's orbit,
 * the browser over two preview routes, the feedback cycle, and the horizon.
 *
 * @param model - the selected stage, the focused preview route, and the selected machine.
 * @param h - the HTML builder the page is assembled with.
 * @returns the /vision document.
 */
export const visionView = (model: Model, h: HtmlBuilder<Message>): Document => {
  const active = Math.min(Math.max(model.visionStep ?? 0, 0), STAGES.length - 1)
  const focus = model.visionFocus ?? "permissions"
  const stage = STAGES[active] ?? STAGES[0]!
  return {
    title: "Tackle — how the factory moves",
    body: h.div(
      [h.Class("shell vision-shell")],
      [
        h.header(
          [h.Class("header")],
          [
            h.div(
              [],
              [
                h.h1([], ["How the factory moves"]),
                h.span(
                  [h.Class("muted")],
                  ["the loop, the isolation boundary, the technology seam, and the horizon"],
                ),
                h.div(
                  [h.Class("nav")],
                  [
                    h.a([h.Href("/")], ["Factory"]),
                    h.a([h.Href("/tackle")], ["Tackle"]),
                    h.a([h.Href("/vision"), h.Class("active")], ["Vision"]),
                  ],
                ),
              ],
            ),
          ],
        ),
        h.div(
          [h.Class("scene-legend")],
          [
            h.span([h.Class("scene-badge built")], ["WORKS"]),
            h.span([h.Class("scene-badge missing")], ["NOT BUILT"]),
            h.span([h.Class("muted")], ["color is status; position is role"]),
          ],
        ),
        h.section(
          [h.Class("vision-scene")],
          [
            sceneHeader(h, {
              title: "Current state",
              caption:
                "A dated snapshot, not a live feed. /factory and /presence are the live readings.",
            }),
            h.div(
              [h.Class("horizon-stack")],
              [
                h.div(
                  [h.Class("horizon-layer today")],
                  [
                    h.span([h.Class("horizon-title")], ["24 Nov 2026"]),
                    horizonItem(h, {
                      tone: "built",
                      title: "main",
                      detail: "main · pnpm check · jig check · CI green",
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
                      tone: "missing",
                      title: "two-project launch",
                      detail: "runbook ready · blocked on target gate decision",
                    }),
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene shop-scene")],
          [
            sceneHeader(h, {
              title: "The factory is a place",
              caption:
                "board is the control plane. room is the bench. protocol is the floor they stand on.",
            }),
            h.div(
              [h.Class("shop-floor")],
              [
                machine(h, { title: "you + Pi", detail: "Herdr terminal", zone: "human-zone" }),
                machine(h, {
                  title: "board",
                  detail: "factory kernel · daemon · queue · relay",
                  zone: "board-zone",
                }),
                h.div(
                  [h.Class("seam-zone")],
                  [
                    h.span([h.Class("seam-title")], ["protocol"]),
                    h.span([h.Class("seam-detail")], ["formats + mailbox decisions · no runtime"]),
                  ],
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
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene substrate-scene")],
          [
            sceneHeader(h, {
              title: "Alchemy is the substrate seam",
              caption:
                "Adopted and runnable: alchemy plan resolves the declaration locally. The same desired state can point at this tailnet, a Fly app, or another provider later.",
            }),
            h.div(
              [h.Class("substrate-map")],
              [
                h.div(
                  [h.Class("substrate-local")],
                  [
                    h.span([h.Class("zone-label local-label")], ["TODAY · TAILNET"]),
                    machine(h, {
                      title: "Board",
                      detail: "factory kernel · daemon · presence",
                      zone: "local-node",
                    }),
                    machine(h, {
                      title: "Room",
                      detail: "worktree · process · port · service",
                      zone: "local-node",
                    }),
                    machine(h, {
                      title: "Mailbox",
                      detail: "local · E2EE · turn log",
                      zone: "local-node",
                    }),
                  ],
                ),
                h.div(
                  [h.Class("substrate-core")],
                  [
                    h.span([h.Class("zone-label")], ["ALCHEMY"]),
                    h.span([h.Class("substrate-title")], ["desired state"]),
                    h.span([h.Class("substrate-detail")], ["providers, not a place"]),
                    h.span([h.Class("provider-chip")], ["tailnet"]),
                    h.span([h.Class("provider-chip")], ["Fly"]),
                    h.span([h.Class("provider-chip")], ["Cloudflare"]),
                  ],
                ),
                h.div(
                  [h.Class("substrate-later")],
                  [
                    h.span([h.Class("zone-label cloud-label")], ["LATER · OPTIONAL"]),
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
                  ],
                ),
              ],
            ),
            h.div(
              [h.Class("substrate-note")],
              [
                "Alchemy is already a board dependency and a real stack declaration. No cloud migration yet: the local shop remains the running provider, and the mailbox/execution plane stay private.",
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene network-scene")],
          [
            sceneHeader(h, {
              title: "The tailnet is the intranet",
              caption:
                "The rack the loop is designed around. Live sessions and services are on /factory; this map does not invent them.",
            }),
            tailnetMap(h, model.visionMachine ?? "mbp1"),
          ],
        ),
        h.section(
          [h.Class("vision-scene orbit-scene")],
          [
            sceneHeader(h, {
              title: "One workstream is an orbit",
              caption: "the stage you select becomes the center of gravity",
            }),
            h.div(
              [h.Class("orbit")],
              [
                ...STAGES.flatMap((entry, index) => [
                  stageNode(h, { stage: entry, index, active }),
                ]),
                h.div(
                  [h.Class("orbit-center")],
                  [
                    h.span(
                      [h.Class("node-kicker")],
                      ["STEP " + String(active + 1).padStart(2, "0")],
                    ),
                    h.h3([], [stage.title]),
                    h.p([], [stage.detail]),
                    h.div(
                      [h.Class("orbit-controls")],
                      [
                        h.button(
                          [h.OnClick(Message.VisionStep({ step: Math.max(0, active - 1) }))],
                          ["Previous"],
                        ),
                        h.button(
                          [h.OnClick(Message.VisionNext())],
                          [active === STAGES.length - 1 ? "Restart" : "Next"],
                        ),
                        h.button([h.OnClick(Message.VisionReset())], ["Reset"]),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene shakti-scene")],
          [
            sceneHeader(h, {
              title: "Two Shakti apps on the tailnet",
              caption: "the tabs are real; the rooms isolate the checkout, not the host",
            }),
            h.div(
              [h.Class("browser")],
              [
                h.div(
                  [h.Class("browser-bar")],
                  [
                    h.span([], ["● ● ●"]),
                    h.span(
                      [h.Class("browser-address")],
                      [
                        focus === "permissions"
                          ? "preview/permissions-1862"
                          : "preview/enterprise-1854",
                      ],
                    ),
                  ],
                ),
                h.div(
                  [h.Class("browser-tabs")],
                  [
                    focusNode(h, { focus: "permissions", active: focus }),
                    focusNode(h, { focus: "enterprise", active: focus }),
                  ],
                ),
                h.div(
                  [h.Class("browser-page")],
                  [
                    h.span(
                      [h.Class("preview-title")],
                      [focus === "permissions" ? "Permissions overhaul" : "Enterprise readiness"],
                    ),
                    h.span([h.Class("muted")], ["same browser · same origin · two preview routes"]),
                  ],
                ),
              ],
            ),
            h.div(
              [h.Class("host-boundary")],
              [
                h.div(
                  [h.Class("room-row")],
                  [
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
                  ],
                ),
                h.div(
                  [h.Class("isolation-warning")],
                  [
                    "Local rooms isolate worktrees, branches, ports, services, and previews. They do not isolate the OS: both still share the host filesystem, network namespace, and processes. The agentOS provider is the prototype for that wall.",
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene cycle-scene")],
          [
            sceneHeader(h, {
              title: "Feedback comes back",
              caption: "a review or check enters at the edge; the next pass leaves from the center",
            }),
            h.div(
              [h.Class("feedback-cycle")],
              [
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
                h.div(
                  [h.Class("cycle-center")],
                  [
                    h.span([h.Class("cycle-title")], ["the loop owns the work"]),
                    h.span(
                      [h.Class("muted")],
                      [
                        "check pass, quality follow-up, ready handoff; outbound labels/comments stay manual",
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene")],
          [
            sceneHeader(h, {
              title: "The technology seam",
              caption:
                "The linked set, decided for this milestone. No dependency was added where the local seam already exists.",
            }),
            h.div(
              [h.Class("horizon-stack")],
              [
                h.div(
                  [h.Class("horizon-layer today")],
                  [
                    h.span([h.Class("horizon-title")], ["adopted / prototyped"]),
                    horizonItem(h, {
                      tone: "built",
                      title: "Alchemy",
                      detail: "adopted · board dependency · alchemy plan resolves",
                    }),
                    horizonItem(h, {
                      tone: "built",
                      title: "agentOS",
                      detail: "adopted · embedded core · own VM per room",
                    }),
                  ],
                ),
                h.div(
                  [h.Class("horizon-layer next")],
                  [
                    h.span([h.Class("horizon-title")], ["deferred / rejected"]),
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
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene horizon-scene")],
          [
            sceneHeader(h, {
              title: "The horizon",
              caption: "local rooms work; embedded agentOS adds the VM wall",
            }),
            h.div(
              [h.Class("horizon-stack")],
              [
                h.div(
                  [h.Class("horizon-layer today")],
                  [
                    h.span([h.Class("horizon-title")], ["today"]),
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
                  ],
                ),
                h.div(
                  [h.Class("horizon-layer next")],
                  [
                    h.span([h.Class("horizon-title")], ["next"]),
                    horizonItem(h, {
                      tone: "built",
                      title: "agentOS provider",
                      detail: "embedded VM per room · separate filesystem and process",
                    }),
                    horizonItem(h, {
                      tone: "missing",
                      title: "agentOS preview bridge",
                      detail: "board still forwards host ports; VM network.preview is next",
                    }),
                    horizonItem(h, {
                      tone: "missing",
                      title: "container",
                      detail: "not chosen for this milestone",
                    }),
                  ],
                ),
                h.div(
                  [h.Class("horizon-layer target")],
                  [
                    h.span([h.Class("horizon-title")], ["target"]),
                    horizonItem(h, {
                      tone: "built",
                      title: "agentOS",
                      detail: "embedded VM · own filesystem and process · local host",
                    }),
                  ],
                ),
                h.div(
                  [h.Class("horizon-outside")],
                  [
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
                  ],
                ),
              ],
            ),
          ],
        ),
      ],
    ),
  }
}
