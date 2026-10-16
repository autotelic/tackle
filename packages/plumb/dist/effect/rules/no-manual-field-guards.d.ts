/**
 * Once a module decodes payloads through SchemaParser, per-field validation
 * belongs in Schema refinements (checks/filters) so evidence flows through the
 * schema issue channel instead of hand-rolled ladders beside the decoder.
 */
export declare const noManualFieldGuardsRule: import("@oxlint/plugins").Rule;
