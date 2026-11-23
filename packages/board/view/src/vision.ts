import type { Document, Html, HtmlBuilder } from "foldkit/html"
import { Message, type Model } from "./main.ts"

/*
 * The vision page is a map, not a second projection of state. Its walkthrough is local:
 * the step and focused room live in the FoldKit model, so the diagram responds without
 * adding a second server source of truth.
 */

interface Step {
  readonly title: string
  readonly detail: string
  readonly tone: "built" | "partial" | "missing"
}

const STEPS: ReadonlyArray<Step> = [
  { title: "project", detail: "Linear project and its issue tree", tone: "partial" },
  { title: "board adopt", detail: "workstream, branch, PR or trunk", tone: "built" },
  { title: "daemon", detail: "one pass per waking event", tone: "built" },
  { title: "worker", detail: "Pi in a Herdr terminal", tone: "built" },
  { title: "worktree", detail: "edits and a checkpoint", tone: "built" },
  { title: "receipt", detail: "quality, cursor, consumed event", tone: "built" },
]

const node = (
  h: HtmlBuilder<Message>,
  title: string,
  detail: string,
  tone: "built" | "partial" | "missing" = "built",
): Html =>
  h.div(
    [h.Class("vision-node " + tone)],
    [
      h.span([h.Class("vision-node-title")], [title]),
      h.span([h.Class("vision-node-detail")], [detail]),
    ],
  )

const arrow = (h: HtmlBuilder<Message>, label = "→") => h.span([h.Class("vision-arrow")], [label])

const row = (h: HtmlBuilder<Message>, children: ReadonlyArray<Html>) =>
  h.div([h.Class("vision-row")], children)

const flow = (h: HtmlBuilder<Message>, children: ReadonlyArray<Html>) =>
  h.div([h.Class("vision-flow")], children)

const badge = (h: HtmlBuilder<Message>, tone: "built" | "partial" | "missing", text: string) =>
  h.span([h.Class("vision-badge " + tone)], [text])

const statusCard = (
  h: HtmlBuilder<Message>,
  tone: "built" | "partial" | "missing",
  title: string,
  body: string,
) =>
  h.div(
    [h.Class("vision-status " + tone)],
    [
      badge(h, tone, tone === "built" ? "WORKS" : tone === "partial" ? "PARTIAL" : "NOT BUILT"),
      h.h3([], [title]),
      h.p([], [body]),
    ],
  )

const stepNode = (h: HtmlBuilder<Message>, step: Step, index: number, active: number): Html => {
  const state = index === active ? " active" : index < active ? " done" : ""
  return h.button(
    [h.Class("vision-node " + step.tone + state), h.OnClick(Message.VisionStep({ step: index }))],
    [
      h.span([h.Class("vision-node-index")], [String(index + 1).padStart(2, "0")]),
      h.span([h.Class("vision-node-title")], [step.title]),
      h.span([h.Class("vision-node-detail")], [step.detail]),
    ],
  )
}

const TIMELINE: ReadonlyArray<{
  readonly at: string
  readonly label: string
  readonly step: number
}> = [
  { at: "0h", label: "adopt", step: 1 },
  { at: "1h", label: "first pass", step: 2 },
  { at: "4h", label: "PR + review", step: 3 },
  { at: "5h", label: "next pass", step: 4 },
  { at: "6h", label: "checkpoint", step: 5 },
]

interface MatrixCell {
  readonly label: string
  readonly tone: "built" | "partial" | "missing"
}

const MATRIX: ReadonlyArray<{ readonly label: string; readonly cells: ReadonlyArray<MatrixCell> }> =
  [
    {
      label: "work",
      cells: [
        { label: "adopt", tone: "built" },
        { label: "events", tone: "built" },
        { label: "passes", tone: "built" },
        { label: "receipts", tone: "built" },
        { label: "trunk / PR", tone: "built" },
      ],
    },
    {
      label: "rooms",
      cells: [
        { label: "worktree", tone: "built" },
        { label: "port", tone: "built" },
        { label: "service", tone: "built" },
        { label: "preview", tone: "built" },
        { label: "container", tone: "missing" },
      ],
    },
    {
      label: "feedback",
      cells: [
        { label: "reviews", tone: "built" },
        { label: "comments", tone: "built" },
        { label: "Linear", tone: "partial" },
        { label: "labels", tone: "missing" },
        { label: "Slack", tone: "missing" },
      ],
    },
  ]

const timelineView = (h: HtmlBuilder<Message>, active: number) =>
  h.div(
    [h.Class("vision-timeline")],
    [
      h.div(
        [h.Class("vision-axis")],
        TIMELINE.map((entry) => h.span([h.Class("vision-tick")], [entry.at])),
      ),
      h.div(
        [h.Class("vision-track")],
        TIMELINE.map((entry) =>
          h.button(
            [
              h.Class("vision-marker" + (entry.step === active ? " active" : "")),
              h.OnClick(Message.VisionStep({ step: entry.step })),
            ],
            [entry.label],
          ),
        ),
      ),
      h.p(
        [h.Class("muted")],
        [
          "Tap a marker to move the walkthrough. This is the ARC timeline, applied to a workstream.",
        ],
      ),
    ],
  )

const matrixView = (h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class("vision-matrix")],
    MATRIX.flatMap((row) => [
      h.span([h.Class("vision-matrix-label")], [row.label]),
      ...row.cells.map((cell) =>
        h.span(
          [h.Class("vision-matrix-cell " + cell.tone), h.Title(cell.label + " · " + cell.tone)],
          [h.span([h.Class("vision-dot")], []), cell.label],
        ),
      ),
    ]),
  )

const kineticRow = (h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class("vision-kinetic")],
    ["reconcile", "build", "land", "done"].flatMap((word, index, all) => [
      h.span([h.Class("vision-kinetic-word")], [word]),
      index === all.length - 1 ? h.span([], []) : h.span([h.Class("vision-kinetic-arrow")], ["→"]),
    ]),
  )

const CURVE: ReadonlyArray<{
  readonly label: string
  readonly level: number
  readonly step: number
}> = [
  { label: "adopt", level: 1, step: 1 },
  { label: "pass 1", level: 2, step: 2 },
  { label: "review", level: 3, step: 3 },
  { label: "pass 2", level: 4, step: 4 },
  { label: "checkpoint", level: 5, step: 5 },
]

const curveView = (h: HtmlBuilder<Message>, active: number) =>
  h.div(
    [h.Class("vision-curve")],
    CURVE.map((point) =>
      h.button(
        [
          h.Class("vision-curve-col" + (point.step === active ? " active" : "")),
          h.OnClick(Message.VisionStep({ step: point.step })),
        ],
        [
          h.span([h.Class("vision-curve-value")], [String(point.level)]),
          h.span([h.Class("vision-curve-bar level-" + point.level)], []),
          h.span([h.Class("vision-curve-label")], [point.label]),
        ],
      ),
    ),
  )

const focusNode = (
  h: HtmlBuilder<Message>,
  focus: "permissions" | "enterprise",
  active: "permissions" | "enterprise",
) =>
  h.button(
    [
      h.Class("vision-node built" + (focus === active ? " active" : "")),
      h.OnClick(Message.VisionFocus({ focus })),
    ],
    [
      h.span(
        [h.Class("vision-node-title")],
        [focus === "permissions" ? "browser tab 1" : "browser tab 2"],
      ),
      h.span(
        [h.Class("vision-node-detail")],
        [focus === "permissions" ? "/preview/permissions-1862/" : "/preview/enterprise-1854/"],
      ),
    ],
  )

export const visionView = (model: Model, h: HtmlBuilder<Message>): Document => {
  const step = Math.min(Math.max(model.visionStep ?? 0, 0), STEPS.length - 1)
  const focus = model.visionFocus ?? "permissions"
  return {
    title: "Tackle — works and next",
    body: h.div(
      [h.Class("shell")],
      [
        h.header(
          [h.Class("header")],
          [
            h.div(
              [],
              [
                h.h1([], ["The factory, today and next"]),
                h.span(
                  [h.Class("muted")],
                  ["one workstream at a time · rooms are not containers yet"],
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
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["The shape"]),
            h.p(
              [],
              [
                "The factory is the behaviour of board driving room. The seam is protocol. " +
                  "The UI is a client of board; it never imports it.",
              ],
            ),
            row(h, [
              node(h, "protocol", "formats + mailbox decisions", "built"),
              arrow(h),
              node(h, "room", "worktree · process · port · service · mail log", "built"),
              arrow(h),
              node(h, "board", "shop · factory kernel · daemon · relay", "built"),
            ]),
            row(h, [
              node(h, "board/view", "/factory · /tackle · /vision", "built"),
              arrow(h, "reads JSON"),
              node(h, "protocol", "presence · atlas · mailbox", "built"),
              arrow(h, "never imports"),
              node(h, "board", "the read surface", "built"),
            ]),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["Starting a project"]),
            h.p(
              [],
              [
                "The picture you describe: open Herdr, open Pi, say “here is the project and its issue tree.”",
              ],
            ),
            flow(h, [
              node(h, "Herdr", "the terminal you open", "built"),
              arrow(h),
              node(h, "Pi session", "the human-facing agent", "built"),
              arrow(h, "not automatic"),
              node(h, "project intake", "description + issue tree", "missing"),
              arrow(h),
              node(h, "board adopt", "workstream record", "built"),
            ]),
            h.div(
              [h.Class("vision-note")],
              [
                h.span(
                  [h.Class("vision-note-title")],
                  ["Today the human or Pi still runs the command"],
                ),
                h.span(
                  [],
                  [
                    "There is no natural-language project intake yet. A person or agent runs board adopt, starts the daemon, " +
                      "and (when it needs a service) creates a room. The workstream record is the durable unit; a room is optional.",
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["The loop that exists"]),
            h.p(
              [],
              [
                "This is the Shakti example: a project, a worktree, a pass, a pull request, and feedback.",
              ],
            ),
            h.div(
              [h.Class("vision-progress")],
              [
                h.span([h.Class("vision-progress-label")], ["WALKTHROUGH"]),
                h.div(
                  [h.Class("vision-progress-rail")],
                  STEPS.map((entry, index) =>
                    h.button(
                      [
                        h.Class("vision-dot" + (index <= step ? " lit" : "")),
                        h.OnClick(Message.VisionStep({ step: index })),
                        h.Title(entry.title),
                      ],
                      [String(index + 1)],
                    ),
                  ),
                ),
              ],
            ),
            flow(
              h,
              STEPS.flatMap((entry, index) => [
                stepNode(h, entry, index, step),
                index === STEPS.length - 1 ? h.span([], []) : arrow(h, index === step ? "→" : ""),
              ]),
            ),
            h.div(
              [h.Class("vision-stage")],
              [
                h.span(
                  [h.Class("vision-stage-label")],
                  ["STEP " + String(step + 1).padStart(2, "0")],
                ),
                h.h3([], [STEPS[step]?.title ?? ""]),
                h.p([], [STEPS[step]?.detail ?? ""]),
                h.div(
                  [h.Class("vision-controls")],
                  [
                    h.button(
                      [h.OnClick(Message.VisionStep({ step: Math.max(0, step - 1) }))],
                      ["Previous"],
                    ),
                    h.button(
                      [h.OnClick(Message.VisionNext())],
                      [step === STEPS.length - 1 ? "Restart" : "Next"],
                    ),
                    h.button([h.OnClick(Message.VisionReset())], ["Reset"]),
                  ],
                ),
              ],
            ),
            h.div(
              [h.Class("vision-note")],
              [
                h.span([h.Class("vision-note-title")], ["What the worker sees"]),
                h.span(
                  [],
                  [
                    "The prompt carries the event. GitHub reviews, comments, and trunk commits are polled after a cursor; " +
                      "each one becomes the next pass. Linear issues are read the same way. The dependency tree is data in Linear, " +
                      "but it is not yet a scheduler gate.",
                  ],
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["The diagram vocabulary"]),
            h.p(
              [],
              [
                "The components are borrowed on purpose: a numbered pipeline from “I gave Pi one tool”, " +
                  "a timeline and a step curve from the ARC log, a kinetic state ribbon from “OpenCode Reloaded”, " +
                  "and staged reveal / focus from 3blue1brown. The content is ours.",
              ],
            ),
            h.ul(
              [h.Class("vision-list")],
              [
                h.li(
                  [],
                  ["Pipeline: numbered stages, one active, a caption that travels with the stage."],
                ),
                h.li(
                  [],
                  [
                    "Timeline: an axis, markers, and a selected event. Good for a workstream's day.",
                  ],
                ),
                h.li(
                  [],
                  [
                    "Matrix: capability rows and status dots. Good for what works and what does not.",
                  ],
                ),
                h.li([], ["Kinetic ribbon: the state word becomes the transition, not a legend."]),
              ],
            ),
            h.h3([], ["Timeline · one workstream"]),
            timelineView(h, step),
            h.h3([], ["Matrix · the honest coverage"]),
            matrixView(h),
            h.h3([], ["Step curve · what landed over time"]),
            curveView(h, step),
            h.p(
              [h.Class("muted")],
              [
                "The ARC post's first-win chart is a cumulative step curve: progress is a staircase, not a slope. " +
                  "Here the steps are the workstream's durable facts, not a velocity claim.",
              ],
            ),
            h.h3([], ["Kinetic ribbon · the state machine"]),
            kineticRow(h),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["Two Shakti apps on one Mac"]),
            h.p([], ["Two workstreams, two rooms, two previews — one shared host."]),
            h.div(
              [h.Class("vision-tabs")],
              [focusNode(h, "permissions", focus), focusNode(h, "enterprise", focus)],
            ),
            h.div(
              [h.Class("vision-focus")],
              [
                h.span([h.Class("vision-focus-label")], ["SELECTED PREVIEW"]),
                h.span(
                  [h.Class("vision-focus-route")],
                  [
                    focus === "permissions"
                      ? "/preview/permissions-1862/"
                      : "/preview/enterprise-1854/",
                  ],
                ),
                h.span(
                  [h.Class("vision-focus-detail")],
                  [
                    focus === "permissions"
                      ? "room A · worktree · :4400 · one web service"
                      : "room B · worktree · :4401 · one web service",
                  ],
                ),
              ],
            ),
            arrow(h, "↓"),
            node(h, "board preview router", "one stable route per workstream", "built"),
            arrow(h, "↓"),
            row(h, [
              h.div(
                [h.Class("vision-node partial" + (focus === "permissions" ? " active" : ""))],
                [
                  h.span([h.Class("vision-node-title")], ["room A"]),
                  h.span([h.Class("vision-node-detail")], ["worktree · :4400 · web"]),
                ],
              ),
              h.div(
                [h.Class("vision-node partial" + (focus === "enterprise" ? " active" : ""))],
                [
                  h.span([h.Class("vision-node-title")], ["room B"]),
                  h.span([h.Class("vision-node-detail")], ["worktree · :4401 · web"]),
                ],
              ),
            ]),
            h.div(
              [h.Class("vision-warning")],
              [
                "The ports and previews are real. The isolation is not: both services share this Mac's " +
                  "filesystem, network namespace, processes, and environment. A container per room is the next slice.",
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["Feedback comes back"]),
            flow(h, [
              node(h, "a review", "GitHub review or comment", "built"),
              arrow(h, "poll"),
              node(h, "event", "github:review / comment", "built"),
              arrow(h),
              node(h, "pass", "worker addresses it", "built"),
              arrow(h),
              node(h, "commit", "pushed to the PR", "built"),
              arrow(h),
              node(h, "receipt", "next cursor", "built"),
            ]),
            h.p(
              [h.Class("muted")],
              [
                "What is not automatic: applying a GitHub label or posting a review reply is in the workstream's " +
                  "declared autonomy, but there is no outbound action executor yet. The worker can do it when prompted.",
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["What is not built"]),
            h.div(
              [h.Class("vision-status-grid")],
              [
                statusCard(
                  h,
                  "partial",
                  "Linear dependency scheduling",
                  "Issues are watched as events. A dependency tree does not yet gate which issue can start.",
                ),
                statusCard(
                  h,
                  "missing",
                  "Container per room",
                  "No Docker, sandbox, or agentOS runtime. Services are host processes on leased ports.",
                ),
                statusCard(
                  h,
                  "missing",
                  "Private database and volumes",
                  "No per-room database, schema, or durable filesystem beyond the worktree.",
                ),
                statusCard(
                  h,
                  "missing",
                  "Multi-service environments",
                  "One declared service per room. A web + api + db set is not representable yet.",
                ),
                statusCard(
                  h,
                  "missing",
                  "Telemetry and log streams",
                  "No listener, no log ingest, no signal-to-event loop.",
                ),
                statusCard(
                  h,
                  "partial",
                  "Rat King transport",
                  "Wire shapes and procedures exist in protocol; board relays fixtures and HTTP. There is no live inter-factory lease/delivery loop yet.",
                ),
                statusCard(
                  h,
                  "missing",
                  "Slack presence",
                  "The desk route enum names slack; there is no Slack client, listener, or product-context feed.",
                ),
                statusCard(
                  h,
                  "missing",
                  "Machine placement",
                  "No shop-to-shop placement. One host owns its rooms and its daemon.",
                ),
              ],
            ),
          ],
        ),
        h.section(
          [h.Class("vision-card")],
          [
            h.h2([], ["The next useful slice"]),
            h.p([], ["In order, without changing the pass semantics:"]),
            h.ul(
              [h.Class("vision-list")],
              [
                h.li(
                  [],
                  [
                    "A container-backed BenchProvider for room; one published port and a private home.",
                  ],
                ),
                h.li(
                  [],
                  [
                    "A dependency-aware Linear queue: an issue starts only when its blockers are done.",
                  ],
                ),
                h.li(
                  [],
                  [
                    "A mailbox transport between shops, using the protocol procedures already in place.",
                  ],
                ),
                h.li(
                  [],
                  [
                    "A Slack presence adapter that turns product context into events, never into code.",
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
