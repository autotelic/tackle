/* oxlint-disable plumb/prefer-property-tests -- the decision is a lookup table over the bindable address forms, and the list of those is the assertion */
import { Option } from "effect"
import { expect, test } from "vitest"
import { loopbackHostFor } from "../src/bind.ts"

test("an address that already answers on loopback gets no second listener", () => {
  for (const host of ["127.0.0.1", "localhost", "0.0.0.0", "::", ""])
    expect(Option.isNone(loopbackHostFor(host)), host).toBe(true)
})

test("a named address gets a loopback companion", () => {
  for (const host of ["100.127.180.9", "::1", "127.0.0.2", " 100.127.180.9 "])
    expect(loopbackHostFor(host), host).toEqual(Option.some("127.0.0.1"))
})
