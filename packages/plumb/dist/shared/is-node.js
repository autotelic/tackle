import { isRecordObject, readField, isString } from "./structural.js";
/**
 * Whether a reflected node-field value is an AST node (as opposed to a child
 * array, literal, or absent).
 * @param {NodeFieldValue} value - Value obtained from reading an ESTree node field.
 * @returns {boolean} True when the value is a single AST node.
 */
export function isNode(value) {
    return isRecordObject(value) && isString(readField(value, "type"));
}
