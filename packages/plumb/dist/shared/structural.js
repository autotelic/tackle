/**
 * Read a field from an ESTree node without chained assertions.
 *
 * SAFETY: callers invoke this after a discriminant (or containment) check that
 * establishes the key exists on the node's runtime shape; the value's domain is
 * owned by the AST grammar (see NodeFieldValue), not by untrusted input.
 *
 * @param {object | null | undefined} node - The node whose field is read.
 * @param {string} key - The field name.
 * @returns {T | undefined} The field value, or undefined when absent.
 */
export function readField(node, key) {
    if (node === null || node === undefined)
        return undefined;
    return node[key];
}
/** Discriminate string-valued fields or expressions of an AST node.
 *
 * @param {NodeFieldValue | ESTree.Expression} value - The value to test.
 * @returns {boolean} True when the value is a string.
 */
export function isString(value) {
    return typeof value === "string";
}
/** All comments in the file, typed for rule consumption.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @returns {CommentLike[]} The file's comments.
 */
export function getAllComments(sourceCode) {
    return sourceCode.getAllComments();
}
/** Discriminate object-valued fields of an AST node (child containers).
 *
 * @param {NodeFieldValue | Record<string, NodeFieldValue>} value - The field value to test.
 * @returns {boolean} True when the value is a non-array object record.
 */
export function isRecordObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
