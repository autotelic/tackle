/**
 * THE decode boundary for rule options.
 *
 * Rule configuration arrives from the lint config file as untyped JSON; the
 * `typeof` discrimination in this module is that boundary decode, sanctioned
 * by this module's single purpose. No other rule file should inspect option
 * representations directly.
 */
export interface OptionRecord {
	readonly [key: string]: unknown;
}

/**
 * Read the first options entry as an object record.
 *
 * @param {readonly unknown[] | undefined} options - The raw `context.options` array.
 * @returns {OptionRecord} The first entry as a record, or an empty record when absent.
 */
export function firstOptionRecord(options: readonly unknown[] | undefined): OptionRecord {
	const first = options?.[0];
	if (first === null || typeof first !== "object" || Array.isArray(first)) return {};
	return first as Record<string, unknown>;
}
