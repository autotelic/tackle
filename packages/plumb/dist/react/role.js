/**
 * Whether a binding name denotes a context Provider (the generic Provider or a
 * family-scoped XProvider). A Provider is the stateful root of a context family
 * and the only component legitimately allowed to use React hooks inline.
 *
 * @param {string} name - The binding name.
 * @returns {boolean} True when the name is `Provider` or ends with `Provider`.
 */
export function isProviderName(name) {
    return name === "Provider" || name.endsWith("Provider");
}
/**
 * Family name contributed by a useXxx export binding.
 *
 * @param {string} name - The exported binding name.
 * @returns {string | null} The family name, or null when not a useXxx hook.
 */
export function hookFamily(name) {
    const match = /^use([A-Z]\w*)$/u.exec(name);
    return match === null ? null : (match[1] ?? null);
}
/**
 * Whether a binding name denotes a custom hook (use + an uppercase letter).
 *
 * @param {string | null} name - The binding name, if known.
 * @returns {name is string} True when the name starts with `use` + a capital.
 */
export function isHookName(name) {
    return name !== null && /^use[A-Z]/u.test(name);
}
