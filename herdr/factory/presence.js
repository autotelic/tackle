/* oxlint-disable plumb/no-runtime-typeof -- a Herdr mod has no Schema and no build step, so
   the /presence document is decoded here, at the seam where it arrives. */

// The panel's decode, kept apart from its drawing: a row holds only what the projection said,
// so the model the tests read is the model the panel renders. A missing field stays missing —
// never filled from a neighbour — and the environment line is built from those same facts.

const ATTENTION = ["blocked", "working", "queued", "idle", "done"]

const listOf = (value) => (Array.isArray(value) ? value : [])
const recordOf = (value) => (value !== null && typeof value === "object" ? value : {})
const textOf = (value) => (typeof value === "string" && value !== "" ? value : null)
const numberOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)
const stateOf = (value) => (typeof value === "string" && ATTENTION.includes(value) ? value : null)

// Unknown and absent states sort after every known one rather than being given a rank.
const rank = (state) => {
  const index = state === null ? -1 : ATTENTION.indexOf(state)
  return index === -1 ? ATTENTION.length : index
}

const ageText = (minutes) => {
  const value = numberOrNull(minutes)
  if (value === null) return null
  if (value < 1) return "under a minute"
  if (value < 60) return Math.round(value) + "m"
  const hours = Math.floor(value / 60)
  if (hours < 24) return hours + "h " + Math.round(value % 60) + "m"
  return Math.floor(hours / 24) + "d"
}

const repoName = (repo) => {
  const name = textOf(repo)
  return name === null ? null : (name.split("/").filter(Boolean).pop() ?? name)
}

/**
 * One drawn row, holding only what the projection actually said.
 *
 * Where the workstream runs comes from factory.environments[]; every part of it is optional,
 * so a board that does not serve the field yet (or a slice that has not landed) draws no
 * environment line. The agent is the projection's own match when it sent one, and the session
 * join is the older evidence path kept for a board that serves no environments.
 *
 * @param {{ workstream: Record<string, any>, activity: Record<string, any>, sessions: Record<string, any>[], environment: any, candidates?: Record<string, any>[] }} input
 * @returns {Record<string, any> | null} the row, or null when the workstream has no identity.
 */
const rowOf = ({ workstream, activity, sessions, environment, candidates }) => {
  const id = textOf(workstream.id)
  if (id === null) return null
  const live = recordOf(activity)
  const pass = recordOf(live.lastPass)
  const budget = recordOf(live.budget)
  const used = numberOrNull(budget.used)
  const cap = numberOrNull(budget.passesPerPhase)
  const pending = listOf(live.pending).length
  const matched = sessions.find(
    (session) => session.workstream === id && textOf(session.address) !== null,
  )
  const facts = recordOf(environment)
  const machine = recordOf(facts.machine)
  const runtime = recordOf(facts.runtime)
  const environmentAgent = recordOf(facts.agent)
  return {
    id,
    label: textOf(workstream.label) ?? id,
    repo: repoName(workstream.repo),
    repoFull: textOf(workstream.repo),
    pr: numberOrNull(workstream.pr),
    phase: textOf(workstream.phase),
    state: stateOf(live.state),
    pass: numberOrNull(pass.pass),
    age: ageText(live.ageMinutes),
    ageMinutes: numberOrNull(live.ageMinutes),
    budget: used === null || cap === null ? null : used + "/" + cap,
    queued: pending === 0 ? null : String(pending) + " queued",
    worker: textOf(workstream.worker),
    machine: textOf(machine.host),
    runtime: textOf(runtime.kind),
    runtimePath: textOf(runtime.path),
    port: numberOrNull(recordOf(facts.port).number),
    vmPort: numberOrNull(facts.vmPort),
    services: listOf(facts.services)
      .map((service) => textOf(recordOf(service).name))
      .filter((name) => name !== null),
    preview: textOf(facts.preview),
    // The lanes are the workstream's own: a candidate id is never matched across workstreams,
    // because a lane is a place this workstream could go and nobody else's.
    candidates: laneRows(candidates),
    address: matched === undefined ? null : textOf(matched.address),
    agent:
      textOf(environmentAgent.status) ?? (matched === undefined ? null : textOf(matched.status)),
  }
}

/**
 * The candidate lanes of one workstream, in the order the board served them.
 *
 * The state travels unchanged and a dropped lane is kept: the panel folds it into one line
 * rather than dropping the fact that it existed.
 *
 * @param {Record<string, any>[] | undefined} candidates - factory.candidates entries for this row.
 * @returns {Record<string, any>[]} the drawn lanes.
 */
const laneRows = (candidates) =>
  listOf(candidates)
    .map((entry) => {
      const lane = recordOf(entry)
      const id = textOf(lane.id)
      if (id === null) return null
      const port = recordOf(lane.port)
      return {
        id,
        label: textOf(lane.label) ?? id,
        state: textOf(lane.state),
        branch: textOf(lane.branch),
        port: numberOrNull(port.number),
        preview: textOf(lane.preview),
      }
    })
    .filter((lane) => lane !== null)

/**
 * One line for a row's lanes: the open ones first, each named with its state, then a count of the
 * dropped ones. Two open lanes are two entries, never one merged sentence.
 *
 * @param {Record<string, any>} row - one drawn row.
 * @returns {string} the joined line, empty when the workstream has no lane.
 */
const candidateText = (row) => {
  const lanes = row.candidates ?? []
  if (lanes.length === 0) return ""
  const open = lanes.filter((lane) => lane.state !== "dropped")
  const dropped = lanes.length - open.length
  return [
    ...open.map((lane) => lane.label + " " + (lane.state ?? "candidate")),
    dropped === 0 ? null : dropped + " dropped",
  ]
    .filter((part) => part !== null)
    .join(" · ")
}

const deskRows = (desk) =>
  listOf(desk)
    .map((item) => {
      const record = recordOf(item)
      const title = textOf(record.title)
      return title === null
        ? null
        : {
            id: textOf(record.id) ?? title,
            title,
            workstream: textOf(record.workstream),
            body: textOf(record.body),
            choices: listOf(record.choices)
              .map((choice) => textOf(choice))
              .filter((choice) => choice !== null),
          }
    })
    .filter((row) => row !== null)

/**
 * Turn a /presence body into what the panel draws. A field that is missing stays missing: it is
 * never filled from a neighbour, so no row invents a phase, a state or a session.
 *
 * @param {any} body - the decoded /presence document.
 * @returns {{ rows: Record<string, any>[], desk: Record<string, any>[], reports: number }} the panel model.
 */
const readPresence = (body) => {
  const root = recordOf(body)
  const factory = recordOf(root.factory)
  const sessions = listOf(recordOf(recordOf(root.sessions).herdr).sessions).map(recordOf)
  const activities = listOf(factory.activity).map(recordOf)
  const environments = listOf(factory.environments).map(recordOf)
  const candidates = listOf(factory.candidates).map(recordOf)
  const rows = listOf(factory.workstreams)
    .map((workstream) => {
      const record = recordOf(workstream)
      const activity = activities.find((entry) => entry.workstream === record.id)
      const environment = environments.find((entry) => entry.workstream === record.id)
      const lanes = candidates.filter((entry) => entry.workstream === record.id)
      return rowOf({
        workstream: record,
        activity: recordOf(activity),
        sessions,
        environment,
        candidates: lanes,
      })
    })
    .filter((row) => row !== null)
    .sort(
      (left, right) =>
        rank(left.state) - rank(right.state) || left.label.localeCompare(right.label),
    )
  return { rows, desk: deskRows(factory.desk), reports: listOf(factory.reports).length }
}

/**
 * The line under a row's label: repo, last pass, age, budget and queued count, each only when
 * the projection sent it.
 *
 * @param {Record<string, any>} row - one drawn row.
 * @returns {string} the joined line, possibly empty.
 */
const metaLine = (row) =>
  [
    row.repo,
    row.pass === null ? null : "pass " + row.pass,
    row.age === null ? null : row.age + " ago",
    row.budget,
    row.queued,
    row.worker === null ? null : "worker " + row.worker,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" · ")

/**
 * The line under the meta line: machine, runtime, the room's leased port, declared services
 * and preview, each only when the projection sent it. No declaration means no service text —
 * a health state is never inferred from a neighbour's.
 *
 * @param {Record<string, any>} row - one drawn row.
 * @returns {string} the joined line, possibly empty.
 */
const environmentText = (row) =>
  [
    row.machine,
    row.runtime === null
      ? null
      : row.runtimePath === null
        ? row.runtime
        : row.runtime + " " + row.runtimePath,
    row.port === null ? null : "port " + row.port,
    row.vmPort === null ? null : "vm port " + row.vmPort,
    row.services.length === 0 ? null : row.services.join(", "),
    row.preview,
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" · ")

export { candidateText, environmentText, metaLine, readPresence }
