import type { ESTree, SourceCode } from "@oxlint/plugins";

/**
 * The closed domain of values reachable from ESTree node fields.
 *
 * Nothing crossing rule logic is `unknown`: reflection over node fields
 * yields exactly this union, so guards accept it instead of re-widening
 * caller evidence to unknown.
 */
export type NodeFieldValue =
	| ESTree.Node
	| readonly ESTree.Node[]
	| string
	| number
	| bigint
	| boolean
	| RegExp
	| null
	| undefined;

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
export function readField<T = NodeFieldValue>(
	node: object | null | undefined,
	key: string,
): T | undefined {
	if (node === null || node === undefined) return undefined;
	return (node as Record<string, T>)[key];
}

/** Discriminate string-valued fields or expressions of an AST node.
 *
 * @param {NodeFieldValue | ESTree.Expression} value - The value to test.
 * @returns {boolean} True when the value is a string.
 */
export function isString(value: NodeFieldValue | ESTree.Expression): value is string {
	return typeof value === "string";
}

/** Engine comment shape, normalized for rule consumption. */
export interface CommentLike {
	type: string;
	value: string;
	end?: number;
	range?: readonly [number, number];
	loc?: {
		start?: { line?: number };
		end?: { line?: number };
	};
}

/** All comments in the file, typed for rule consumption.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @returns {CommentLike[]} The file's comments.
 */
export function getAllComments(sourceCode: SourceCode): CommentLike[] {
	return sourceCode.getAllComments() as CommentLike[];
}



/** Discriminate object-valued fields of an AST node (child containers).
 *
 * @param {NodeFieldValue | Record<string, NodeFieldValue>} value - The field value to test.
 * @returns {boolean} True when the value is a non-array object record.
 */
export function isRecordObject(
	value: NodeFieldValue | Record<string, NodeFieldValue>,
): value is Record<string, NodeFieldValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
