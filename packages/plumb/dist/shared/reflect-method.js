/** Reports whether a call target names one method on the global Reflect object.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Expression} callee - The callee expression of the call.
 * @param {string} methodName - The Reflect method name to match.
 * @returns {boolean} True when the call targets the global `Reflect`.
 */
export function isGlobalReflectMethodCall({ sourceCode, callee, methodName, }) {
    if (!("property" in callee) || !("object" in callee) || !("computed" in callee))
        return false;
    const object = callee.object;
    if (object.type !== "Identifier" || object.name !== "Reflect")
        return false;
    if (!sourceCode.isGlobalReference(object)) {
        let resolved = null;
        let scope = sourceCode.getScope(object);
        while (scope !== null) {
            const variable = scope.set.get(object.name);
            if (variable !== undefined) {
                resolved = variable;
                break;
            }
            scope = scope.upper;
        }
        if (resolved !== null && resolved.defs.length > 0)
            return false;
    }
    const property = callee.property;
    return callee.computed
        ? property.type === "Literal" && property.value === methodName
        : property.type === "Identifier" && property.name === methodName;
}
