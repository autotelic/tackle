import { Room, type RoomEnv } from "./room.ts"

/*
 * The Worker entry.
 *
 * One room per Durable Object, addressed by the name in the path: `/r/<room>/...`. The name
 * is the encoded room id (`linear:<projectId>@<stage>`), so two people's local rooms are two
 * objects and cannot share a row. celld's `dev` listener and Cloudflare's route both speak
 * this same URL, which is what makes the move a hosting change.
 */

export { Room }

export default {
  async fetch(request: Request, env: RoomEnv): Promise<Response> {
    const url = new URL(request.url)
    const match = /^\/r\/([^/]+)(\/.*)$/.exec(url.pathname)
    const encoded = match?.[1]
    const rest = match?.[2]
    if (encoded === undefined || rest === undefined) {
      return new Response("room: expected /r/<room>/<path>\n", { status: 404 })
    }
    const room = decodeURIComponent(encoded)
    const stub = env.ROOMS.get(env.ROOMS.idFromName(room))
    const forwarded = new URL(rest, url.origin)
    return stub.fetch(new Request(forwarded, request))
  },
}
