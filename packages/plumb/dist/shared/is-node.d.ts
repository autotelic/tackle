import type { ESTree } from "@oxlint/plugins";
import { type NodeFieldValue } from "./structural.ts";
/**
 * Whether a reflected node-field value is an AST node (as opposed to a child
 * array, literal, or absent).
 * @param {NodeFieldValue} value - Value obtained from reading an ESTree node field.
 * @returns {boolean} True when the value is a single AST node.
 */
export declare function isNode(value: NodeFieldValue): value is ESTree.Node;
