/* oxlint-disable plumb-effect/guarded-op-must-return-effect -- a wildcard that already answers on loopback needing no second listener is a normal state, not a failure reason */
import { Option } from "effect"

const WILDCARDS = new Set(["", "0.0.0.0", "::", "localhost", "127.0.0.1"])

/**
 * The loopback address to listen on beside `host`, or none when it already answers there.
 *
 * `board up --host <tailnet address>` serves other shops and hides the shop from the tools on
 * the machine running it: the Herdr factory panel reads http://127.0.0.1:4780/presence. A
 * wildcard already answers on loopback, so only a named address needs the second listener.
 *
 * @param host - the address the operator asked the board to bind.
 * @returns Some("127.0.0.1") to add beside the primary bind, or none.
 */
export const loopbackHostFor = (host: string): Option.Option<string> =>
  WILDCARDS.has(host.trim().toLowerCase()) ? Option.none() : Option.some("127.0.0.1")
