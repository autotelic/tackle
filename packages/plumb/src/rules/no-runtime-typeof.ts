import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { readField } from "../shared/structural.ts";
import { ancestorsOf } from "../shared/ancestors.ts";

import { firstOptionRecord } from "../shared/rule-options.ts";

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
		},
		messages: {
			runtimeTypeof:
				"A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
		},
		schema: [
			{
				type: "object",
				properties: {
					allowInTypeGuards: { type: "boolean" },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ allowInTypeGuards: false }],
	},
	createOnce(context) {
		return {
			UnaryExpression(node) {
				if (node.operator !== "typeof") return;
				const option = firstOptionRecord(context.options);
				const allowInTypeGuards = option.allowInTypeGuards === true;
				let insideTypeGuard = false;
				if (allowInTypeGuards) {
					const ancestors = ancestorsOf(context.sourceCode, node);
					for (let index = ancestors.length - 1; index >= 0; index--) {
						const current = ancestors[index]!;
						if (current.type === "Program") break;
						if (
							current.type === "ArrowFunctionExpression" ||
							current.type === "FunctionDeclaration" ||
							current.type === "FunctionExpression"
						) {
							insideTypeGuard =
								current.returnType?.typeAnnotation.type === "TSTypePredicate";
							break;
						}
					}
				}
				if (!insideTypeGuard) context.report({ node, messageId: "runtimeTypeof" });
			},
		};
	},
});
