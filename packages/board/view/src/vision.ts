import type { Document, Html, HtmlBuilder } from "foldkit/html"
import type { Message } from "./main.ts"

/*
 * The vision page is deliberately static: it is a map of what the factory can do, not a
 * second projection of state. The live facts stay on /factory and /tackle.
 */

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

export const visionView = (_model: unknown, h: HtmlBuilder<Message>): Document => ({
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
          flow(h, [
            node(h, "project", "Linear project + issues", "partial"),
            arrow(h, "events"),
            node(h, "board adopt", "workstream + branch + PR", "built"),
            arrow(h),
            node(h, "daemon", "one pass per waking event", "built"),
            arrow(h),
            node(h, "worker", "Pi in a Herdr terminal", "built"),
            arrow(h),
            node(h, "worktree", "edits + checkpoint", "built"),
            arrow(h),
            node(h, "receipt", "quality + consumed events", "built"),
          ]),
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
          h.h2([], ["Two Shakti apps on one Mac"]),
          h.p([], ["Two workstreams, two rooms, two previews — one shared host."]),
          h.div(
            [h.Class("vision-tabs")],
            [
              node(h, "browser tab 1", "/preview/permissions-1862/", "built"),
              node(h, "browser tab 2", "/preview/enterprise-1854/", "built"),
            ],
          ),
          arrow(h, "↓"),
          node(h, "board preview router", "one stable route per workstream", "built"),
          arrow(h, "↓"),
          row(h, [
            node(h, "room A", "worktree · :4400 · web", "partial"),
            node(h, "room B", "worktree · :4401 · web", "partial"),
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
})
