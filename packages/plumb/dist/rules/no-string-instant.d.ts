/** Whether a field name claims to be an instant.
 *
 * @param {string} name - The field's name.
 * @returns {boolean} True when the name is a date or a time.
 */
export declare function namesAnInstant(name: string): boolean;
/**
 * An instant is a value with an identity, not the text of one.
 *
 * `"2026-10-22T00:00:00Z"` and `"2026-10-22 00:00:00+00"` agree until one of
 * them crosses a timezone. A string field in the values stratum lets every
 * reader parse it differently, so the format becomes folklore instead of a
 * type. The wire type may be text; the value must not.
 */
export declare const noStringInstantRule: import("@oxlint/plugins").Rule;
