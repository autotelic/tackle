import type { ESTree, SourceCode } from "@oxlint/plugins";
interface ReflectMethodCallInput {
    sourceCode: SourceCode;
    callee: ESTree.Expression;
    methodName: string;
}
/** Reports whether a call target names one method on the global Reflect object.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Expression} callee - The callee expression of the call.
 * @param {string} methodName - The Reflect method name to match.
 * @returns {boolean} True when the call targets the global `Reflect`.
 */
export declare function isGlobalReflectMethodCall({ sourceCode, callee, methodName, }: ReflectMethodCallInput): boolean;
export {};
