import { seed } from "./data.js"

const STORAGE_KEY = "room-inventory"
const external = document.querySelector("#external-port")
if (external !== null) external.textContent = location.port || "80"

const style = `
  :host { display: block; }
  .head { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; margin-bottom: 14px; }
  h2 { margin: 0; font: 600 20px/1.2 ui-sans-serif, system-ui, sans-serif; }
  .summary { color: #667085; font: 12px/1.4 ui-monospace, SFMono-Regular, monospace; }
  .room { border: 1px solid #d0d5dd; border-radius: 10px; padding: 14px; margin-top: 10px; background: #fff; }
  .row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
  .id { font: 600 15px/1.2 ui-monospace, SFMono-Regular, monospace; }
  .state { border: 1px solid #98a2b3; border-radius: 999px; padding: 2px 8px; font: 11px/1.5 ui-monospace, SFMono-Regular, monospace; }
  .mono { color: #475467; font: 12px/1.5 ui-monospace, SFMono-Regular, monospace; }
  .muted { color: #98a2b3; font: 12px/1.5 ui-monospace, SFMono-Regular, monospace; }
  button { margin-left: auto; border: 1px solid #344054; background: #fff; border-radius: 6px; padding: 5px 9px; cursor: pointer; font: 12px/1 ui-monospace, SFMono-Regular, monospace; }
  button:hover { background: #f2f4f7; }
  .note { margin-top: 16px; color: #667085; font: 12px/1.5 ui-sans-serif, system-ui, sans-serif; }
`

class RoomInventory extends HTMLElement {
  #rooms = this.load()
  #root

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored === null ? structuredClone(seed) : JSON.parse(stored)
    } catch {
      return structuredClone(seed)
    }
  }

  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#rooms))
  }

  connectedCallback() {
    this.#root = this.attachShadow({ mode: "open" })
    this.#root.addEventListener("click", (event) => {
      const id = event.target?.dataset?.toggle
      if (id === undefined) return
      const room = this.#rooms.find((entry) => entry.id === id)
      if (room !== undefined && room.vm !== undefined) {
        room.vm =
          room.vm.state === "running" ? { state: "absent" } : { state: "running", pid: 9001 }
        this.save()
        this.render()
      }
    })
    this.render()
  }

  render() {
    this.#root.innerHTML = `<style>${style}</style>` + this.markup()
  }

  markup() {
    const running = this.#rooms.filter((room) => room.vm?.state === "running").length
    return `
      <div class="head">
        <h2>Room inventory</h2>
        <span class="summary">${this.#rooms.length} rooms · ${running} supervisors running</span>
      </div>
      ${this.#rooms.map((room) => this.room(room)).join("")}
      <p class="note">Variant A keeps state inside the component, persists it under the same <code>${STORAGE_KEY}</code> key, and renders its own shadow root.</p>
    `
  }

  room(room) {
    const vm =
      room.vm === undefined
        ? ""
        : `<span class="mono">vm ${room.vm.state}${room.vm.pid === undefined ? "" : " · pid " + room.vm.pid}</span>`
    const process =
      room.process === null
        ? `<span class="muted">no process</span>`
        : `<span class="mono">process ${room.process.pid} · ${room.process.alive ? "alive" : "dead"}</span>`
    const toggle =
      room.vm === undefined
        ? ""
        : `<button data-toggle="${room.id}">${room.vm.state === "running" ? "stop vm" : "start vm"}</button>`
    return `<article class="room"><div class="row"><span class="id">${room.id}</span><span class="state">${room.state}</span>${room.runtime === undefined ? "" : `<span class="mono">${room.runtime}</span>`}${vm}${process}${toggle}</div></article>`
  }
}

customElements.define("room-inventory", RoomInventory)
