// The decode lives in ./presence.js: a Herdr mod has no Schema and no build step, so the
// /presence document is decoded there, at the seam where it arrives.

// The factory's attention panel: one row per workstream, ordered by what needs a person,
// read from the board's /presence projection. A field the projection did not send gets no
// line here — a phase, a state or a session is never inferred from a neighbour.
import { View, div } from "gpui-kit"
import { h_flex, v_flex } from "gpui-base"
import { agents, appHome, checking, exec, run, terminals, theme, window } from "herdr"
import { readdir } from "fs/promises"
import { environmentText, metaLine, readPresence } from "./presence.js"

// One seam, one address. The board binds loopback by default and adds a loopback listener
// beside a tailnet address, so the panel carries no address book of its own.
const PRESENCE = "http://127.0.0.1:4780/presence"
const VIEW = "http://127.0.0.1:4780/factory"
const POLL = 15000
const STATES = {
  blocked: "Blocked",
  working: "Working",
  queued: "Queued",
  idle: "Idle",
  done: "Done",
}
const AGENT_STATES = {
  working: "Agent working",
  blocked: "Agent blocked",
  done: "Agent done",
  idle: "Agent idle",
}
const LINKS = { "branch-issue": "Branch Issue", "branch-pr": "Branch PR" }
const OPENERS = { macos: "open", windows: "explorer", linux: "xdg-open" }

/**
 * The color a state wears, from the theme's own state names.
 *
 * @param {{ theme: Record<string, string>, state: string | null }} input
 * @returns {string} a color from the theme.
 */
const stateColor = ({ theme: t, state }) => {
  const colors = { blocked: t.blocked, working: t.working, queued: t.accent, done: t.done }
  return colors[state] ?? t.idle
}

const agentColor = ({ theme: t, agent }) => {
  const colors = { blocked: t.blocked, working: t.working, done: t.done }
  return colors[agent] ?? t.muted
}

/**
 * Decode a JSON document, or nothing when it is not one: a half-written or error body is
 * silence at this seam, not a finding.
 *
 * @param {string} text - the body curl printed.
 * @returns {Promise<unknown>} the document, or null.
 */
const decodeJson = async (text) => JSON.parse(text)

/**
 * Read /presence once, with curl through the host's exec: a mod is handed no HTTP client, and
 * running programs is how the app's own mods reach the world. A board that is down, a non-zero
 * exit, or a body that is not JSON is null, so the panel says offline instead of keeping rows
 * that may no longer be true.
 *
 * @returns {Promise<Record<string, any> | null>} the model, or null when the seam is silent.
 */
const readLivePresence = async () => {
  const result = await exec("curl", ["-sS", "--max-time", "5", PRESENCE]).catch(() => null)
  if (result === null || result.code !== 0) return null
  const body = await decodeJson(result.stdout).catch(() => null)
  return body === null ? null : readPresence(body)
}

// The web view is the reading surface and the only one at phone width, so a desk item links
// there instead of growing an answer form inside a 320px column.
const openView = (path) => {
  const platform = window()?.platform ?? "macos"
  const opener = OPENERS[platform] ?? OPENERS.macos
  exec(opener, [path]).catch(() => null)
  return null
}

// Branch Issue / Branch PR are someone else's mods: link to them when they are installed,
// show nothing when they are not.
const installedLinks = async () => {
  const names = await readdir(appHome() + "/mods").catch(() => [])
  return Object.keys(LINKS).filter((name) => names.includes(name))
}

/**
 * The empty state's words.
 *
 * @param {{ loaded: boolean, online: boolean }} input - what the last poll established.
 * @returns {{ title: string, detail: string }} the two lines to draw.
 */
const emptyCopy = ({ loaded, online }) => {
  if (!loaded) return { title: "Reading /presence", detail: "The panel asks once at start." }
  if (!online)
    return {
      title: "Presence is unreachable",
      detail: "board up serves /presence; the panel asks again every 15 seconds.",
    }
  return {
    title: "No workstreams adopted",
    detail: "The board's /presence answers once a workstream exists.",
  }
}

export default class Factory extends View {
  /** `herdr-app check` runs init for real, so it must not reach the network or the mods folder. */
  init(_props, cx) {
    this.cx = cx
    this.rows = []
    this.desk = []
    this.reports = 0
    this.online = false
    this.loaded = false
    this.links = []
    if (checking()) return
    cx.spawn(async (cx) => {
      this.links = await installedLinks()
      cx.notify()
    })
    cx.timer.every(POLL, (timerCx) => this.refresh(timerCx))
    this.refresh(cx)
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const model = await readLivePresence()
      this.rows = model === null ? [] : model.rows
      this.desk = model === null ? [] : model.desk
      this.reports = model === null ? 0 : model.reports
      this.online = model !== null
      this.loaded = true
      cx.notify()
    })
  }

  badge(t, text, color) {
    return h_flex()
      .flex_none()
      .px(6)
      .py(2)
      .rounded(5)
      .bg(t.raised)
      .child(div().text_size(11).text_color(color).child(text))
  }

  header(t) {
    const blocked = this.rows.filter((row) => row.state === "blocked").length
    return h_flex()
      .id("factory-head")
      .flex_none()
      .items_center()
      .gap(8)
      .px(12)
      .py(9)
      .child(div().font_semibold().child("Factory"))
      .when(blocked > 0, (el) => el.child(this.badge(t, String(blocked), t.blocked)))
      .child(div().flex_1())
      .when(this.reports > 0, (el) =>
        el.child(
          div()
            .id("factory-reports")
            .text_size(11)
            .text_color(t.dim)
            .cursor_pointer()
            .hover((style) => style.text_color(t.muted))
            .on_click(() => openView(VIEW))
            .child(this.reports + " reports"),
        ),
      )
      .when(this.desk.length > 0, (el) =>
        el.child(
          h_flex()
            .id("factory-desk-badge")
            .items_center()
            .gap(5)
            .px(7)
            .py(2)
            .rounded(6)
            .bg(t.raised)
            .cursor_pointer()
            .hover((style) => style.bg(t.hover))
            .on_click(() => openView(VIEW))
            .child(div().text_size(11).text_color(t.accent).child("Needs you"))
            .child(div().text_size(11).font_semibold().child(String(this.desk.length))),
        ),
      )
      .when(this.loaded && !this.online, (el) =>
        el.child(div().text_size(11).text_color(t.dim).child("offline")),
      )
  }

  row(t, row, live) {
    const color = stateColor({ theme: t, state: row.state })
    const meta = metaLine(row)
    const environment = environmentText(row)
    const canFocus = row.address !== null && live.has(row.address)
    return h_flex()
      .id("factory-" + row.id)
      .flex_none()
      .items_center()
      .gap(8)
      .px(12)
      .py(7)
      .child(div().w(6).h(6).flex_none().rounded(3).bg(color))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(
            h_flex()
              .items_center()
              .gap(6)
              .child(div().truncate().child(row.label))
              .when(row.state !== null, (el) =>
                el.child(this.badge(t, STATES[row.state] ?? row.state, color)),
              )
              .when(row.agent !== null, (el) =>
                el.child(
                  this.badge(
                    t,
                    AGENT_STATES[row.agent] ?? row.agent,
                    agentColor({ theme: t, agent: row.agent }),
                  ),
                ),
              ),
          )
          .when(meta !== "", (el) =>
            el.child(div().text_size(11).text_color(t.dim).truncate().child(meta)),
          )
          .when(environment !== "", (el) =>
            el.child(div().text_size(11).text_color(t.dim).truncate().child(environment)),
          ),
      )
      .when(canFocus, (el) =>
        el.child(
          h_flex()
            .id("factory-focus-" + row.id)
            .flex_none()
            .px(7)
            .py(3)
            .rounded(6)
            .border(1)
            .border_color(t.border)
            .cursor_pointer()
            .hover((style) => style.bg(t.hover))
            .on_click(() => run("agent.focus", { terminal: row.address }))
            .child(div().text_size(11).text_color(t.muted).child("Focus")),
        ),
      )
  }

  empty(t) {
    const copy = emptyCopy({ loaded: this.loaded, online: this.online })
    return v_flex()
      .px(12)
      .py(8)
      .gap(4)
      .child(div().text_color(t.muted).child(copy.title))
      .child(div().text_size(11).text_color(t.dim).child(copy.detail))
  }

  answer(item, choice) {
    exec("curl", [
      "-sS",
      "-X",
      "POST",
      "-H",
      "content-type: application/json",
      "--data",
      JSON.stringify({ item, choice, by: "herdr" }),
      "http://127.0.0.1:4780/desk/answer",
    ])
      .then(() => this.refresh(this.cx))
      .catch(() => null)
    return null
  }

  deskSection(t) {
    return v_flex()
      .flex_none()
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .px(12)
          .py(7)
          .child(div().text_size(11).font_semibold().text_color(t.muted).child("Needs you"))
          .child(
            div()
              .text_size(11)
              .text_color(t.dim)
              .child(this.desk.length + (this.desk.length === 1 ? " decision" : " decisions")),
          ),
      )
      .children(
        this.desk.map((item) =>
          v_flex()
            .id("factory-desk-" + item.id)
            .gap(4)
            .px(12)
            .py(8)
            .border_t(1)
            .border_color(t.border)
            .child(div().font_semibold().truncate().child(item.title))
            .when(item.body !== null, (el) =>
              el.child(div().text_size(11).text_color(t.dim).truncate().child(item.body)),
            )
            .child(
              h_flex()
                .gap(6)
                .wrap()
                .children(
                  item.choices.map((choice) =>
                    h_flex()
                      .id("factory-desk-choice-" + item.id + "-" + choice)
                      .px(7)
                      .py(3)
                      .rounded(6)
                      .border(1)
                      .border_color(t.border)
                      .cursor_pointer()
                      .hover((style) => style.bg(t.hover))
                      .on_click(() => this.answer(item.id, choice))
                      .child(div().text_size(11).text_color(t.muted).child(choice)),
                  ),
                ),
            ),
        ),
      )
  }

  linkRow(t) {
    return v_flex()
      .flex_none()
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .px(12)
          .py(7)
          .children(
            this.links.map((name) =>
              h_flex()
                .id("factory-link-" + name)
                .flex_none()
                .px(7)
                .py(3)
                .rounded(6)
                .border(1)
                .border_color(t.border)
                .cursor_pointer()
                .hover((style) => style.bg(t.hover))
                .on_click(() => run("mod.open", { name }))
                .child(
                  div()
                    .text_size(11)
                    .text_color(t.muted)
                    .child(LINKS[name] ?? name),
                ),
            ),
          ),
      )
  }

  render() {
    const t = theme()
    const live = new Set([
      ...agents().map((agent) => agent.address),
      ...terminals().map((terminal) => terminal.address),
    ])
    return v_flex()
      .id("factory-root")
      .size_full()
      .bg(t.surface)
      .text_size(13)
      .child(this.header(t))
      .child(div().h(1).flex_none().bg(t.border))
      .child(
        v_flex()
          .flex_1()
          .overflow_y_scrollbar()
          .py(4)
          .when(this.rows.length === 0, (el) => el.child(this.empty(t)))
          .children(this.rows.map((row) => this.row(t, row, live)))
          .when(this.desk.length > 0, (el) => el.child(this.deskSection(t))),
      )
      .when(this.links.length > 0, (el) => el.child(this.linkRow(t)))
  }
}
