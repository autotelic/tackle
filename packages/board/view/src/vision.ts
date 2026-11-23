import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { Message, type Model } from "./main.ts"

/*
 * A map, not a second projection of state. The scenes borrow their spatial grammar from
 * the linked posts: a place with zones, an orbit with a focused stage, a browser over a
 * host, a feedback cycle, and a horizon. The live facts stay on /factory and /tackle.
 */

interface Stage {
  readonly title: string
  readonly detail: string
  readonly tone: "built" | "partial" | "missing"
}

const STAGES: ReadonlyArray<Stage> = [
  { title: "project", detail: "Linear project + issue tree", tone: "partial" },
  { title: "adopt", detail: "workstream, branch, PR", tone: "built" },
  { title: "daemon", detail: "one pass per waking event", tone: "built" },
  { title: "worker", detail: "Pi in a Herdr terminal", tone: "built" },
  { title: "worktree", detail: "edits + checkpoint", tone: "built" },
  { title: "receipt", detail: "quality + cursor", tone: "built" },
]

const stageClass = (index: number, active: number): string =>
  "orbit-node orbit-" + index + (index === active ? " active" : index < active ? " done" : "")

const stageNode = (h: HtmlBuilder<Message>, stage: Stage, index: number, active: number): Html =>
  h.button(
    [h.Class(stageClass(index, active)), h.OnClick(Message.VisionStep({ step: index }))],
    [
      h.span([h.Class("node-kicker")], [String(index + 1).padStart(2, "0")]),
      h.span([h.Class("node-title")], [stage.title]),
      h.span([h.Class("node-detail")], [stage.detail]),
    ],
  )

const badge = (h: HtmlBuilder<Message>, tone: "built" | "partial" | "missing") =>
  h.span(
    [h.Class("scene-badge " + tone)],
    [tone === "built" ? "WORKS" : tone === "partial" ? "PARTIAL" : "NOT BUILT"],
  )

const deviceChip = (h: HtmlBuilder<Message>, text: string) =>
  h.span([h.Class("device-chip")], [text])

const chipRow = (h: HtmlBuilder<Message>, items: ReadonlyArray<string>) =>
  h.div(
    [h.Class("device-chips")],
    items.map((item) => deviceChip(h, item)),
  )

const workstreamTile = (h: HtmlBuilder<Message>, name: string, repo: string, service: string) =>
  h.div(
    [h.Class("device-workstream")],
    [
      h.span([h.Class("device-workstream-name")], [name]),
      h.span([h.Class("device-workstream-repo")], [repo]),
      h.span([h.Class("device-workstream-service")], [service]),
    ],
  )

const deviceCard = (
  h: HtmlBuilder<Message>,
  title: string,
  subtitle: string,
  children: ReadonlyArray<Html>,
  tone = "",
) =>
  h.div(
    [h.Class("device-card " + tone)],
    [
      h.div(
        [h.Class("device-head")],
        [
          h.span([h.Class("device-title")], [title]),
          h.span([h.Class("device-subtitle")], [subtitle]),
        ],
      ),
      ...children,
    ],
  )

const phoneCard = (h: HtmlBuilder<Message>, title: string, surface: string) =>
  h.div(
    [h.Class("phone-card")],
    [
      h.span([h.Class("phone-notch")], []),
      h.span([h.Class("device-title")], [title]),
      h.span([h.Class("device-subtitle")], [surface]),
    ],
  )

const sceneHeader = (h: HtmlBuilder<Message>, title: string, caption: string) =>
  h.div([h.Class("scene-head")], [h.h2([], [title]), h.p([], [caption])])

const focusNode = (
  h: HtmlBuilder<Message>,
  focus: "permissions" | "enterprise",
  active: "permissions" | "enterprise",
) =>
  h.button(
    [
      h.Class("tab" + (focus === active ? " active" : "")),
      h.OnClick(Message.VisionFocus({ focus })),
    ],
    [
      h.span([h.Class("tab-title")], [focus === "permissions" ? "Tab 1" : "Tab 2"]),
      h.span(
        [h.Class("tab-route")],
        [focus === "permissions" ? "permissions-1862" : "enterprise-1854"],
      ),
    ],
  )

const arrowLabel = (h: HtmlBuilder<Message>, text: string) =>
  h.span([h.Class("scene-arrow-label")], [text])

const machine = (h: HtmlBuilder<Message>, title: string, detail: string, className: string) =>
  h.div(
    [h.Class("machine " + className)],
    [h.span([h.Class("machine-title")], [title]), h.span([h.Class("machine-detail")], [detail])],
  )

const room = (h: HtmlBuilder<Message>, title: string, detail: string, active: boolean) =>
  h.div(
    [h.Class("room-bench" + (active ? " active" : ""))],
    [h.span([h.Class("room-title")], [title]), h.span([h.Class("room-detail")], [detail])],
  )

const cycleNode = (h: HtmlBuilder<Message>, title: string, detail: string, className: string) =>
  h.div(
    [h.Class("cycle-node " + className)],
    [h.span([h.Class("node-title")], [title]), h.span([h.Class("node-detail")], [detail])],
  )

const horizonItem = (
  h: HtmlBuilder<Message>,
  tone: "built" | "partial" | "missing",
  title: string,
  detail: string,
) =>
  h.div(
    [h.Class("horizon-item " + tone)],
    [
      badge(h, tone),
      h.span([h.Class("node-title")], [title]),
      h.span([h.Class("node-detail")], [detail]),
    ],
  )

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
                  ["a spatial map of the loop, the isolation boundary, and the horizon"],
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
            h.span([h.Class("scene-badge partial")], ["PARTIAL"]),
            h.span([h.Class("scene-badge missing")], ["NOT BUILT"]),
            h.span([h.Class("muted")], ["color is status; position is role"]),
          ],
        ),
        h.section(
          [h.Class("vision-scene shop-scene")],
          [
            sceneHeader(
              h,
              "The factory is a place",
              "board is the control plane. room is the bench. protocol is the floor they stand on.",
            ),
            h.div(
              [h.Class("shop-floor")],
              [
                machine(h, "you + Pi", "Herdr terminal", "human-zone"),
                machine(h, "board", "factory kernel · daemon · queue · relay", "board-zone"),
                h.div(
                  [h.Class("seam-zone")],
                  [
                    h.span([h.Class("seam-title")], ["protocol"]),
                    h.span([h.Class("seam-detail")], ["formats + mailbox decisions · no runtime"]),
                  ],
                ),
                machine(h, "room A", "worktree · process · port · service", "room-zone room-a"),
                machine(h, "room B", "another worktree · another service", "room-zone room-b"),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene substrate-scene")],
          [
            sceneHeader(
              h,
              "Alchemy is the substrate seam",
              "The same desired state can point at this tailnet, a Fly app, or another provider. Today it points at local machines.",
            ),
            h.div(
              [h.Class("substrate-map")],
              [
                h.div(
                  [h.Class("substrate-local")],
                  [
                    h.span([h.Class("zone-label local-label")], ["TODAY · TAILNET"]),
                    machine(h, "Board", "factory kernel · daemon · presence", "local-node"),
                    machine(h, "Room", "worktree · process · port · service", "local-node"),
                    machine(h, "Mailbox", "local · E2EE · turn log", "local-node"),
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
                    machine(h, "control plane", "same entities, hosted", "cloud-node"),
                    machine(h, "rooms", "same bench contract", "cloud-node"),
                    machine(h, "mailbox", "stays private", "cloud-node"),
                  ],
                ),
              ],
            ),
            h.div(
              [h.Class("substrate-note")],
              [
                "No cloud migration yet. Alchemy is the layer that lets the same definitions be pointed at local machines now and another provider later; the mailbox and the execution plane remain a separate, private choice.",
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene network-scene")],
          [
            sceneHeader(
              h,
              "The tailnet is the intranet",
              "Three MacBook Pros, one Mac mini, and two phones. The smaller cards are the running surfaces inside each machine.",
            ),
            h.div(
              [h.Class("tailnet-board")],
              [
                h.div(
                  [h.Class("outside-strip")],
                  [
                    h.span([h.Class("zone-label")], ["OUTSIDE"]),
                    deviceChip(h, "Linear"),
                    deviceChip(h, "GitHub"),
                    deviceChip(h, "Slack"),
                  ],
                ),
                h.div(
                  [h.Class("tailnet-frame")],
                  [
                    h.span([h.Class("zone-label tailnet-label")], ["TAILNET · taila38bf7.ts.net"]),
                    h.div(
                      [h.Class("device-grid")],
                      [
                        deviceCard(
                          h,
                          "MacBook Pro 1",
                          "shop · board · factory UI",
                          [
                            chipRow(h, ["board", "factory UI", "Herdr"]),
                            workstreamTile(
                              h,
                              "permissions-1862",
                              "forestbuilder",
                              "web :4400 · healthy",
                            ),
                            workstreamTile(
                              h,
                              "enterprise-1854",
                              "forestbuilder",
                              "web :4401 · healthy",
                            ),
                          ],
                          "shop",
                        ),
                        deviceCard(h, "MacBook Pro 2", "Herdr + Rex", [
                          chipRow(h, ["Herdr", "Rex"]),
                          workstreamTile(
                            h,
                            "tackle-factory",
                            "autotelic/tackle",
                            "trunk · daemon · preview",
                          ),
                        ]),
                        deviceCard(h, "MacBook Pro 3", "Herdr + Rex", [
                          chipRow(h, ["Herdr", "Rex"]),
                          workstreamTile(
                            h,
                            "factory-view",
                            "autotelic/tackle",
                            "web :4402 · review",
                          ),
                        ]),
                        deviceCard(
                          h,
                          "Mac mini",
                          "always-on shop",
                          [
                            chipRow(h, ["board daemon", "factory records", "mailbox"]),
                            workstreamTile(
                              h,
                              "durable source",
                              "records + events",
                              "no service · always on",
                            ),
                          ],
                          "mini",
                        ),
                      ],
                    ),
                    h.div(
                      [h.Class("phone-row")],
                      [phoneCard(h, "Phone A", "Herdr"), phoneCard(h, "Phone B", "Rex")],
                    ),
                  ],
                ),
              ],
            ),
            h.div(
              [h.Class("network-flow")],
              [
                h.span([h.Class("flow-tag")], ["KICK OFF"]),
                machine(h, "you", "Herdr or Rex", "flow-node"),
                h.span([h.Class("bridge-arrow")], ["→"]),
                machine(h, "factory UI", "/factory · /tackle · /vision", "flow-node"),
                h.span([h.Class("bridge-arrow")], ["→"]),
                machine(h, "board", "adopt · event · daemon", "flow-node"),
                h.span([h.Class("bridge-arrow")], ["→"]),
                machine(h, "room", "worktree · port · service", "flow-node"),
                h.span([h.Class("bridge-arrow")], ["→"]),
                machine(h, "preview tab", "review the work", "flow-node"),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene orbit-scene")],
          [
            sceneHeader(
              h,
              "One workstream is an orbit",
              "the stage you select becomes the center of gravity",
            ),
            h.div(
              [h.Class("orbit")],
              [
                ...STAGES.flatMap((entry, index) => [stageNode(h, entry, index, active)]),
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
            sceneHeader(
              h,
              "Two Shakti apps on the tailnet",
              "the tabs are real; the wall between them is not",
            ),
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
                  [focusNode(h, "permissions", focus), focusNode(h, "enterprise", focus)],
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
                    room(h, "room A", "worktree · :4400 · web", focus === "permissions"),
                    room(h, "room B", "worktree · :4401 · web", focus === "enterprise"),
                  ],
                ),
                h.div(
                  [h.Class("isolation-warning")],
                  [
                    "No container wall. Both rooms see the same filesystem, network namespace, and processes. agentOS is the next provider.",
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene cycle-scene")],
          [
            sceneHeader(
              h,
              "Feedback comes back",
              "a review enters at the edge; the next pass leaves from the center",
            ),
            h.div(
              [h.Class("feedback-cycle")],
              [
                cycleNode(h, "review", "GitHub review or comment", "cycle-review"),
                cycleNode(h, "event", "cursor advances", "cycle-event"),
                cycleNode(h, "pass", "worker addresses it", "cycle-pass"),
                cycleNode(h, "commit", "pushed to the PR", "cycle-commit"),
                cycleNode(h, "receipt", "next cursor + evidence", "cycle-receipt"),
                h.div(
                  [h.Class("cycle-center")],
                  [
                    h.span([h.Class("cycle-title")], ["the loop owns the work"]),
                    h.span([h.Class("muted")], ["outbound labels/comments are not automated yet"]),
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-scene horizon-scene")],
          [
            sceneHeader(
              h,
              "The horizon",
              "today is a directory; the target is a VM with a preview network",
            ),
            h.div(
              [h.Class("horizon-stack")],
              [
                h.div(
                  [h.Class("horizon-layer today")],
                  [
                    h.span([h.Class("horizon-title")], ["today"]),
                    horizonItem(h, "built", "directory", "worktree + process + port"),
                    horizonItem(h, "partial", "room", "one service, shared host"),
                  ],
                ),
                h.div(
                  [h.Class("horizon-layer next")],
                  [
                    h.span([h.Class("horizon-title")], ["next"]),
                    horizonItem(
                      h,
                      "missing",
                      "container",
                      "Docker · published port · private home",
                    ),
                  ],
                ),
                h.div(
                  [h.Class("horizon-layer target")],
                  [
                    h.span([h.Class("horizon-title")], ["target"]),
                    horizonItem(
                      h,
                      "missing",
                      "agentOS",
                      "VM · durable fs · network.preview · digest software",
                    ),
                  ],
                ),
                h.div(
                  [h.Class("horizon-outside")],
                  [
                    horizonItem(h, "partial", "Linear dependencies", "events, not a queue gate"),
                    horizonItem(
                      h,
                      "missing",
                      "telemetry / Slack",
                      "no listener or product-context feed",
                    ),
                    horizonItem(
                      h,
                      "partial",
                      "Rat King transport",
                      "procedures + relay fixtures; no live delivery",
                    ),
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
