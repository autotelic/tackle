/**
 * Read the first options entry as an object record.
 *
 * @param {readonly unknown[] | undefined} options - The raw `context.options` array.
 * @returns {OptionRecord} The first entry as a record, or an empty record when absent.
 */
export function firstOptionRecord(options) {
    const first = options?.[0];
    if (first === null || typeof first !== "object" || Array.isArray(first))
        return {};
    return first;
}
