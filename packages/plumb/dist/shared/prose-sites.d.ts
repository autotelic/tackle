import type { ESTree } from "@oxlint/plugins";
import { type CommentLike, type NodeFieldValue } from "./structural.ts";
/** A spec file. Its literals are fixtures, and a fixture holds the defect on
 * purpose: the test asserts that the rule reports it. */
export declare const TEST_FILE: RegExp;
/** Prose a person reads in a source file: a comment, or a string literal. */
export interface ProseSite {
    readonly text: string;
    readonly line: number;
    readonly column: number;
}
/** The words in a comment, with its `*` prefixes removed and its lines joined.
 *
 * A wrapped comment is one sentence, so matching the raw value loses every phrase
 * that spans a line break, and those are the long ones.
 *
 * @param {CommentLike} comment - A comment from `sourceCode.getAllComments()`.
 * @returns {ProseSite} The prose, and the line it starts on.
 */
export declare function proseOfComment(comment: CommentLike): ProseSite;
/** The words in a string literal, when it holds a sentence rather than a token.
 *
 * A literal with no space is an identifier, a path, a format name or a selector:
 * it is never read as prose, and reporting it would be reporting the code.
 *
 * @param {NodeFieldValue | ESTree.Expression | undefined} value - The literal's `value`, or a template element's `cooked`.
 * @returns {string | undefined} The text, or undefined when it is not words.
 */
export declare function proseOfLiteral(value: NodeFieldValue | ESTree.Expression | undefined): string | undefined;
/** The first phrase in a text that matches one of a rule's patterns.
 *
 * @param {string} text - The prose, already joined onto one line.
 * @param {ReadonlyArray<RegExp>} patterns - What the rule is looking for.
 * @returns {string | undefined} The matched phrase, or undefined when none matches.
 */
export declare function firstMatch(text: string, patterns: ReadonlyArray<RegExp>): string | undefined;
