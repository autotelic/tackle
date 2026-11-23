import { Schema } from "effect"

/*
 * The workspace atlas, as the view decodes it.
 *
 * Every field the board serves is optional where a smaller workspace can omit it, so a
 * board with no README or no edges still renders the packages it did send.
 */

export const AtlasPackage = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  path: Schema.String,
  description: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  scripts: Schema.optional(Schema.Array(Schema.String)),
  workspaceDependencies: Schema.optional(Schema.Array(Schema.String)),
  summary: Schema.optional(Schema.NullOr(Schema.String)),
})
export type AtlasPackage = typeof AtlasPackage.Type

export const AtlasEdge = Schema.Struct({ from: Schema.String, to: Schema.String })
export type AtlasEdge = typeof AtlasEdge.Type

export const Atlas = Schema.Struct({
  generatedAt: Schema.optional(Schema.String),
  workspace: Schema.optional(Schema.String),
  packages: Schema.Array(AtlasPackage),
  edges: Schema.Array(AtlasEdge),
})
export type Atlas = typeof Atlas.Type
