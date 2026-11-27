import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join, normalize, sep } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

/*
 * Both containers run this server on the same internal port, 4400. The variant is selected by
 * the container's environment, not by a path: from inside the container, the service is just
 * `web :4400`; from outside, Compose publishes each container on a different host port.
 */
const root = dirname(fileURLToPath(import.meta.url))
const variant = process.env.VARIANT === "b" ? "b" : "a"
const port = Number(process.env.PORT ?? 4400)
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
}

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)
  const relative = path === "/" ? "/variant-" + variant + ".html" : path
  const file = normalize(join(root, relative))
  if (!file.startsWith(root + sep)) {
    response.writeHead(403).end("forbidden")
    return
  }
  readFile(file).then(
    (body) => {
      response.writeHead(200, {
        "content-type": types[extname(file)] ?? "application/octet-stream",
      })
      response.end(body)
    },
    () => response.writeHead(404).end("not found"),
  )
}).listen(port, "0.0.0.0", () => console.log("web :" + port + " · variant " + variant))
