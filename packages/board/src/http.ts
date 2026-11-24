import type { ServerResponse } from "node:http"

/** Write one JSON response with no caching and an exact content length. */
export const json = ({
  response,
  status,
  body,
}: {
  readonly response: ServerResponse
  readonly status: number
  readonly body: unknown
}): void => {
  const text = JSON.stringify(body) + "\n"
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
}
