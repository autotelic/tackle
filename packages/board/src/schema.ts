import * as Schema from "effect/Schema"

/**
 * A JSON object whose values are not interpreted at this boundary. Atlas manifests and
 * remote presence sessions both cross as unknown records; naming the shape once keeps the
 * two decoders from drifting apart.
 */
export const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown)
