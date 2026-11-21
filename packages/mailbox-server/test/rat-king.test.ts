import { expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Host } from "../src/records.ts"

const checkout = process.env.RAT_KING_CHECKOUT
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(checkout ?? "", "lexicons", "fixtures", "v0", name + ".json"), "utf8"),
  )

/** The pinned checkout is external data; this suite is meaningless without it. */
const runner = checkout === undefined ? test.skip : test
runner(
  "the pinned Rat King checkout admits its message and resolves our record",
  () => {
    const now = Date.parse("2026-10-04T00:00:00.000Z")
    const input = fixture("send.input")
    const expected = fixture("send.output")
    const sender = input.envelope.aad.senderDid
    const host = new Host("did:key:zOurHost")

    const admitted = host.admit(input.envelope, sender, now)
    if (!admitted.ok) throw new Error(admitted.error._tag)
    expect(admitted.value).toEqual(expected.receipt)

    const published = host.publish("dev.autotelic.work.ship", "ship-1", {
      message: input.envelope.aad.messageId,
      sha: "9c49c10b843f8ee5626a5511aa2f28949767c994",
    })
    expect(published.uri).toBe("at://did:key:zOurHost/dev.autotelic.work.ship/ship-1")
    expect(published.cid.startsWith("bafy")).toBe(true)
    expect(host.lookup(published.cid)).toBeDefined()
  },
  20_000,
)
