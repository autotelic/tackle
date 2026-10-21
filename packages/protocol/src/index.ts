/**
 * `@autotelic/protocol` — the lexicons the conformance tools agree on, as pure types, JSON
 * Schema, and pure helpers.
 *
 * This package is deliberately not a tool: it has no dependencies and no runtime beyond
 * pure functions. The engines agree on bytes; they never import each other. A record's
 * lexicon — not this module — is the contract, and `lexicon.ts` is the registry of them.
 */
export * from "./lexicon.ts"
export * from "./decode.ts"
export * from "./json.ts"
export * from "./report.ts"
export * from "./baseline.ts"
export * from "./config.ts"
export * from "./intent.ts"
export * from "./patterns.ts"
export * from "./recipes.ts"
export * from "./catalog.ts"
export * from "./doc.ts"
export * from "./compat.ts"
