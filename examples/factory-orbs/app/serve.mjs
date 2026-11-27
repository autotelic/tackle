import { createServer } from "node:http"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { build, readState, readWorktree } from "./build.mjs"

/*
 * One factory's HTTP surface. The service listens on the same internal port in every container;
 * the outside world reaches a factory through the host port Compose published for it. The API is
 * how a supervisor (or a person) manipulates this factory without touching its sibling.
 */
const port = Number(process.env.PORT ?? 4400)
const json = (response, status, body) => {
  const bytes = Buffer.from(JSON.stringify(body) + "\n")
  response.writeHead(status, { "content-type": "application/json", "content-length": bytes.length })
  response.end(bytes)
}

const stateOf = async () => {
  const [state, worktree] = await Promise.all([readState(), readWorktree()])
  return { factory: process.env.FACTORY_ID ?? "factory", internalPort: port, ...state, ...worktree }
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname
  if (request.method === "GET" && path === "/api/state") {
    json(response, 200, await stateOf())
    return
  }
  if (request.method === "POST" && path === "/api/note") {
    let body = ""
    for await (const chunk of request) body += chunk
    let note = ""
    try {
      note = String(JSON.parse(body).note ?? "")
    } catch {
      json(response, 400, { error: "body must be JSON with a note" })
      return
    }
    if (note === "") {
      json(response, 400, { error: "note is required" })
      return
    }
    const state = await readState()
    await writeFile(
      join(process.cwd(), "src", "state.json"),
      JSON.stringify({ note, revision: state.revision + 1 }, null, 2) + "\n",
    )
    await build()
    json(response, 200, await stateOf())
    return
  }
  if (request.method === "GET" && (path === "/" || path === "/index.html")) {
    const body = await readFile(join(process.cwd(), "public", "index.html")).catch(() => undefined)
    if (body === undefined) {
      json(response, 503, { error: "not built" })
      return
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
    })
    response.end(body)
    return
  }
  json(response, 404, { error: "not found" })
})

server.listen(port, "0.0.0.0", () =>
  console.log("factory " + (process.env.FACTORY_ID ?? "factory") + " serving web :" + port),
)
