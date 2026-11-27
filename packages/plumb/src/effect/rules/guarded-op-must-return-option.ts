import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { ancestorsOf } from "../../shared/ancestors.ts";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

type FunctionWithReturnType = ESTree.ArrowFunctionExpression | ESTree.Function;

function isNullableKeyword(type: ESTree.TSType): boolean {
	return type.type === "TSNullKeyword" || type.type === "TSUndefinedKeyword";
}

/**
 * Returns whether a union pairs a nullable member with at least one real
 * value type (T | null/undefined, not void | undefined).
 *
 * @param {ESTree.TSUnionType} union - The union annotation to inspect.
 * @returns {boolean} True when the union mixes null/undefined with value types.
 */
function nullableWithValue(union: ESTree.TSUnionType): boolean {
	let nullable = false;
	let value = false;
	for (const member of union.types) {
		if (isNullableKeyword(member)) {
			nullable = true;
		} else if (member.type !== "TSVoidKeyword" && member.type !== "TSNeverKeyword") {
			value = true;
		}
	}
	return nullable && value;
}

function asUnion(type: ESTree.TSType): ESTree.TSUnionType | null {
	if (type.type === "TSParenthesizedType") return asUnion(type.typeAnnotation);
	return type.type === "TSUnionType" ? type : null;
}

/**
 * Guarded operations must surface absence as Either<T, TaggedReason>, not a
 * null/undefined union or a crash. This rule once recommended Option; that made
 * it contradict `guarded-op-must-return-effect`, which rejects Option because it
 * discards the reason. Recommending Either here is what makes the pair agree.
 * The rule id keeps its historical name so consumer configs do not break.
 */
export const guardedOpMustReturnOptionRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow returning T | null/undefined from guarded operations and getOrThrow escapes; express absence as Either<T, TaggedReason> so the reason survives. Option<T> is not the answer: guarded-op-must-return-effect rejects it for hiding the why.",
		},
		messages: {
			nullableReturn:
				"This function returns `{{type}}`, conflating absence with a value. Return `Either<{{value}}, TaggedReason>` (Effect's `Either`) with a Schema.TaggedError reason for why the value is absent; absence here is a failure that has a why, and `Option<{{value}}>` would hide it.",
			optionEscape:
				"`getOrThrow` turns absence into a runtime crash. Match the `Either<T, TaggedReason>` and handle the Left, or parse to a refined value so the empty branch can't exist.",
		},
	},
	createOnce(context) {

		const checkReturnType = (node: FunctionWithReturnType) => {
			const annotation = node.returnType;
			if (annotation === null || annotation === undefined) return;
			const type = annotation.typeAnnotation;
			const union = asUnion(type);
			if (union === null || !nullableWithValue(union)) return;
			const value = union.types
				.filter((member) => !isNullableKeyword(member) && member.type !== "TSVoidKeyword")
				.map((member) => context.sourceCode.getText(member))
				.join(" | ");
			context.report({
				node: type,
				messageId: "nullableReturn",
				data: { type: context.sourceCode.getText(type), value },
			});
		};

		return {
		before() {
			if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
		},
			ArrowFunctionExpression: checkReturnType,
			FunctionDeclaration: checkReturnType,
			FunctionExpression: checkReturnType,
			MemberExpression(node) {
				if (
					!node.computed &&
					node.property.type === "Identifier" &&
					node.property.name === "getOrThrow"
				) {
					context.report({ node, messageId: "optionEscape" });
				}
			},
			Identifier(node) {
				if (node.name !== "getOrThrow") return;
				const parent = (ancestorsOf(context.sourceCode, node)).at(-1);
				if (parent?.type === "MemberExpression" && parent.property === node) return;
				context.report({ node, messageId: "optionEscape" });
			},
		};
	},
});
