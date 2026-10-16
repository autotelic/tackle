/**
 * The wire-format version carried by every artifact the tools exchange.
 *
 * A report, a baseline, and a catalog each declare the version of the shape they
 * were written in, so a reader can tell "this is from an older tool" from "this is
 * corrupt". Bump it when a field's meaning changes, not when one is added.
 */
export const PROTOCOL_VERSION = "0.1.0"
