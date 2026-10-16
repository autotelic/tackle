/**
 * `@autotelic/protocol` — the four seams as pure types, JSON Schema, and pure helpers.
 *
 * This package is deliberately not a tool: it has no dependencies and no runtime
 * beyond pure functions. The engines agree on bytes; they never import each other.
 */
export * from "./version.ts"
export * from "./report.ts"
export * from "./baseline.ts"
export * from "./config.ts"
export * from "./catalog.ts"
export * from "./doc.ts"
