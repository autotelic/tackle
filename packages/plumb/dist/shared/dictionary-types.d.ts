import type { ESTree } from "@oxlint/plugins";
export type UnsafeDictionary = {
    readonly kind: "unsafe-dictionary";
    readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};
export type WideningTargetKind = "anonymous object" | "generic container" | "object" | "open dictionary" | "unknown";
export type WideningTarget = {
    readonly kind: WideningTargetKind;
};
export type TypeEnvironment = {
    readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
    readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
    readonly shadowedBuiltIns: ReadonlySet<string>;
};
/**
 * Build the alias/interface maps for a program so type references can be
 * resolved to their declarations during dictionary classification.
 * @param {ESTree.Program} program - Root AST node of the file under lint.
 * @returns {TypeEnvironment} Environment mapping declared names to their declaration nodes.
 */
export declare function createTypeEnvironment(program: ESTree.Program): TypeEnvironment;
/**
 * Classify a single type as an unsafe dictionary value, if it is one.
 * @param {ESTree.TSType} valueType - Type annotation of the dictionary value slot.
 * @param {TypeEnvironment} environment - Declared-alias environment from createTypeEnvironment.
 * @returns {UnsafeDictionary | null} The unsafe kind ("any", "unknown", "object", "empty-object") or null.
 */
export declare function classifyUnsafeDictionaryValue(valueType: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null;
/**
 * Classify the value side of an index-signature or Record dictionary.
 * @param {ESTree.TSType} type - The dictionary type node being inspected.
 * @param {TypeEnvironment} environment - Declared-alias environment from createTypeEnvironment.
 * @returns {UnsafeDictionary | null} Classification with kind and location, or null when safe.
 */
export declare function classifyUnsafeDictionary(type: ESTree.TSType, environment: TypeEnvironment): UnsafeDictionary | null;
/**
 * Describe what a widening assignment erases, for report messaging.
 * @param {ESTree.TSType} type - The assigned (widened) type.
 * @param {TypeEnvironment} environment - Declared-alias environment from createTypeEnvironment.
 * @returns {WideningTarget | null} Human-readable target description, or null when not a widening.
 */
export declare function classifyWideningTarget(type: ESTree.TSType, environment: TypeEnvironment): WideningTarget | null;
/**
 * Whether an expression is an object literal carrying at least one property.
 * @param {ESTree.Expression} expression - Candidate expression node.
 * @returns {boolean} True only for ObjectExpression nodes with members.
 */
export declare function isPopulatedObjectExpression(expression: ESTree.Expression): boolean;
/**
 * Whether an expression carries first-hand type evidence (schema parse,
 * literal, typed constructor) and therefore needs no further guarding.
 * @param {ESTree.Expression} expression - Candidate expression node.
 * @returns {boolean} True when the expression is self-evidencing.
 */
export declare function isKnownEvidenceExpression(expression: ESTree.Expression): boolean;
