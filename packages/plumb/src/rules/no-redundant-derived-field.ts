import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { isRecordObject, isString } from "../shared/structural.ts";

const COUNT_SUFFIX = /(?:Count|Length|Size)$/u;
const COUNT_PREFIX = /^(?:count|num|numberOf|total)(?=[A-Z])/u;
const KEYED_COLLECTION_NAMES = new Set(["Array", "Map", "Record", "ReadonlyArray", "ReadonlyMap", "ReadonlySet", "Set"]);

function lastTypeNameSegment(typeName: ESTree.Node): string | null {
	if (typeName.type === "Identifier") return typeName.name;
	if (typeName.type === "TSQualifiedName") return lastTypeNameSegment(typeName.right);
	return null;
}

function propertyName(member: ESTree.TSSignature): string | null {
	if (member.type !== "TSPropertySignature") return null;
	const key = member.key;
	return key.type === "Identifier" ? key.name : null;
}

function propertyAnnotation(member: ESTree.TSSignature): ESTree.TSType | null | undefined {
	if (member.type !== "TSPropertySignature") return null;
	return member.typeAnnotation?.typeAnnotation ?? null;
}

/** Lowercase, strip separators, and naive-singularise so `seatOrder`/`seats`, `entryIndex`/`entries` stems can be compared.
 *
 * @param {string} name - The field or property name to fold.
 * @returns {string} The comparison stem.
 */
function normaliseName(name: string): string {
	const folded = name.replaceAll(/[^a-zA-Z0-9]/gu, "").toLowerCase();
	if (folded.endsWith("ies") && folded.length > 4) return `${folded.slice(0, -3)}y`;
	return folded.endsWith("s") && folded.length > 3 ? folded.slice(0, -1) : folded;
}

/** Extract the `x` from `xCount`, `countX`, `numberOfX`, … otherwise null.
 *
 * @param {string} name - The candidate count-field name.
 * @returns {string | null} The counted stem, or null when the name isn't a count pattern.
 */
function countStem(name: string): string | null {
	const suffixMatch = name.match(COUNT_SUFFIX);
	if (suffixMatch !== null && suffixMatch.index !== null) return name.slice(0, suffixMatch.index);
	const prefixMatch = name.match(COUNT_PREFIX);
	if (prefixMatch !== null) {
		const stem = name.slice(prefixMatch[0].length);
		return stem.charAt(0).toLowerCase() + stem.slice(1);
	}
	return null;
}

/** Whether the annotation is any array/map/set/record shape.
 *
 * @param {ESTree.TSType | null | undefined} annotation - The annotation to inspect.
 * @returns {boolean} True when the annotation denotes a keyed collection.
 */
function isCollectionLike(annotation: ESTree.TSType | null | undefined): boolean {
	if (annotation === null || annotation === undefined) return false;
	if (annotation.type === "TSTypeReference") {
		const name = lastTypeNameSegment(annotation.typeName);
		return name !== null && KEYED_COLLECTION_NAMES.has(name);
	}
	return annotation.type === "TSTypeOperator" && annotation.operator === "readonly"
		? isCollectionLike(annotation.typeAnnotation)
		: annotation.type === "TSArrayType";
}

/** Whether the annotation is an array (or readonly array reference) whose element is a primitive keyword.
 *
 * @param {ESTree.TSType | null | undefined} annotation - The annotation to inspect.
 * @returns {"string" | "number" | null} The primitive keyword of the element type, or null.
 */
function arrayOfPrimitiveKeys(annotation: ESTree.TSType | null | undefined): "string" | "number" | null {
	if (annotation === null || annotation === undefined) return null;
	let elementType: ESTree.TSType | undefined;
	if (annotation.type === "TSArrayType") {
		elementType = annotation.elementType;
	} else if (
		annotation.type === "TSTypeOperator" &&
		annotation.operator === "readonly" &&
		annotation.typeAnnotation.type === "TSArrayType"
	) {
		elementType = annotation.typeAnnotation.elementType;
	} else if (
		annotation.type === "TSTypeReference" &&
		annotation.typeArguments != null &&
		annotation.typeArguments.params.length === 1
	) {
		const name = lastTypeNameSegment(annotation.typeName);
		if (name === "Array" || name === "ReadonlyArray") elementType = annotation.typeArguments.params[0];
	}
	if (elementType === undefined) return null;
	if (elementType.type === "TSStringKeyword") return "string";
	if (elementType.type === "TSNumberKeyword") return "number";
	return null;
}

/** First type argument's primitive keyword for a keyed collection like `Record<string, T>` / `Map<string, T>`.
 *
 * @param {ESTree.TSType | null | undefined} annotation - The annotation to inspect.
 * @returns {"string" | "number" | null} The key keyword, or null when not a keyed reference.
 */
function keyKeywordOf(annotation: ESTree.TSType | null | undefined): "string" | "number" | null {
	if (annotation?.type !== "TSTypeReference") return null;
	const first = annotation.typeArguments?.params[0] ?? null;
	if (first === null || first === undefined) return null;
	if (first.type === "TSStringKeyword") return "string";
	if (first.type === "TSNumberKeyword") return "number";
	return null;
}

/**
 * One fact, one place: a type that stores data *and* a field derivable from
 * that data keeps two sources of truth that drift apart independently. Counts
 * belong to read sites; ordering belongs in the structure itself.
 */
export const noRedundantDerivedFieldRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow fields that duplicate information derivable from a sibling field on the same type (derived counts, parallel key/order arrays); compute or encode them instead.",
		},
		messages: {
			redundantCount:
				"`{{name}}` restates what is derivable from `{{sibling}}`, giving the type two sources of truth that can drift. Drop it and compute the count at read time.",
			parallelKeyArray:
				"`{{name}}` mirrors the keys of `{{sibling}}` as a second source of truth that can drift. Encode the canonical form (e.g. ordering) in the collection itself instead of a parallel array.",
		},
	},
	createOnce(context) {
		function checkMembers(members: ESTree.TSSignature[]): void {
			for (const member of members) {
				const name = propertyName(member);
				if (name === null) continue;
				const annotation = propertyAnnotation(member);

				const stem = countStem(name);
				if (stem !== null && annotation?.type === "TSNumberKeyword") {
					const stemNorm = normaliseName(stem);
					const sibling = members.find((other) => {
						if (other === member) return false;
						const otherName = propertyName(other);
						return otherName !== null && normaliseName(otherName) === stemNorm && isCollectionLike(propertyAnnotation(other));
					});
					if (sibling !== undefined) {
						context.report({
							node: member,
							messageId: "redundantCount",
							data: { name, sibling: propertyName(sibling) ?? "" },
						});
						continue;
					}
				}

				const elementKey = arrayOfPrimitiveKeys(annotation);
				if (elementKey === null) continue;
				const nameNorm = normaliseName(name);
				const sibling = members.find((other) => {
					if (other === member) return false;
					const otherName = propertyName(other);
					if (otherName === null) return false;
					if (keyKeywordOf(propertyAnnotation(other)) !== elementKey) return false;
					const otherNorm = normaliseName(otherName);
					return otherNorm.includes(nameNorm) || nameNorm.includes(otherNorm);
				});
				if (sibling !== undefined) {
					context.report({
						node: member,
						messageId: "parallelKeyArray",
						data: { name, sibling: propertyName(sibling) ?? "" },
					});
				}
			}
		}

		function memberList(bodyNode: ESTree.TSInterfaceBody): ESTree.TSSignature[] {
			return [...bodyNode.body];
		}

		return {
			TSInterfaceDeclaration(node) {
				checkMembers(memberList(node.body));
			},
			TSTypeAliasDeclaration(node) {
				if (node.typeAnnotation.type === "TSTypeLiteral") checkMembers(node.typeAnnotation.members);
			},
		};
	},
});
