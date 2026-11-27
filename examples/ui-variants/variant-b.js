import { seed } from "./data.js"

const STORAGE_KEY = "room-inventory"
const app = document.querySelector("#app")
const external = document.querySelector("#external-port")
if (external !== null) external.textContent = location.port || "80"

const load = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? structuredClone(seed) : JSON.parse(stored)
  } catch {
    return structuredClone(seed)
  }
}

let rooms = load()

const span = (className, text) => {
  const node = document.createElement("span")
  node.className = className
  node.textContent = text
  return node
}

const room = (entry) => {
  const article = document.createElement("article")
  article.className = "room"
  const row = document.createElement("div")
  row.className = "row"
  row.append(span("id", entry.id), span("state", entry.state))
  if (entry.runtime !== undefined) row.append(span("mono", entry.runtime))
  if (entry.vm !== undefined) {
    row.append(
      span(
        "mono",
        "vm " + entry.vm.state + (entry.vm.pid === undefined ? "" : " · pid " + entry.vm.pid),
      ),
    )
    const button = document.createElement("button")
    button.dataset.toggle = entry.id
    button.textContent = entry.vm.state === "running" ? "stop vm" : "start vm"
    row.append(button)
  }
  row.append(
    entry.process === null
      ? span("muted", "no process")
      : span(
          "mono",
          "process " + entry.process.pid + " · " + (entry.process.alive ? "alive" : "dead"),
        ),
  )
  article.append(row)
  return article
}

const render = () => {
  const running = rooms.filter((entry) => entry.vm?.state === "running").length
  const head = document.createElement("div")
  head.className = "head"
  const heading = document.createElement("h2")
  heading.textContent = "Room inventory"
  head.append(
    heading,
    span("summary", rooms.length + " rooms · " + running + " supervisors running"),
  )
  const note = document.createElement("p")
  note.className = "note"
  note.textContent =
    "Variant B renders direct DOM nodes from module state, persists the same " +
    STORAGE_KEY +
    " key, and one listener delegates the buttons."
  app.replaceChildren(head, ...rooms.map(room), note)
}

app.addEventListener("click", (event) => {
  const id = event.target?.dataset?.toggle
  if (id === undefined) return
  const entry = rooms.find((room) => room.id === id)
  if (entry !== undefined && entry.vm !== undefined) {
    entry.vm = entry.vm.state === "running" ? { state: "absent" } : { state: "running", pid: 9001 }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms))
    render()
  }
})

render()
