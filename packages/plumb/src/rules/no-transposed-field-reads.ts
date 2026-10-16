import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { isString } from "../shared/structural.ts";
import { firstOptionRecord } from "../shared/rule-options.ts";

interface Options {
	readonly groups?: ReadonlyArray<readonly string[]>;
}

/** A direct field pluck: `base.field` with an identifier property (no arithmetic, no nesting). */
interface FieldPluck {
	readonly baseText: string;
	readonly field: string;
	readonly position: number;
}

/** The `base.field` pluck of a direct member read, or null for anything more elaborate.
 * @param {ESTree.Expression | null | undefined} expression - Argument or spread expression to inspect.
 * @param {(node: ESTree.Node) => string} getText - Source text accessor from the lint context.
 * @returns {{ baseText: string; field: string }} Base text and field name, or null when not a simple pluck. */
function directPluck(
	expression: ESTree.Expression | ESTree.SpreadElement | null | undefined,
	getText: (node: ESTree.Node) => string,
): { baseText: string; field: string } | null {
	if (expression === undefined || expression === null) return null;
	let member = expression;
	while (member.type === "ParenthesizedExpression") member = member.expression;
	if (member.type !== "MemberExpression" || member.computed || member.property.type !== "Identifier") {
		return null;
	}
	return { baseText: getText(member.object), field: member.property.name };
}

/**
 * Flag argument lists and object literals that pluck two or more role fields
 * off the same base expression in reversed canonical order: the syntactic
 * fingerprint of inline structural surgery on a domain value (e.g. a
 * hand-rolled reciprocal). Such shuffles belong behind a named operation
 * that owns the invariant.
 */
export const noTransposedFieldReadsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				'Disallow directly reading two or more configured role fields from the same expression in reversed order inside call arguments or object literals; require a named domain operation instead. Configure `groups` with your domain\'s canonical field pairings (e.g. groups: [["startDate", "endDate"]]).',
		},
		messages: {
			transposedFieldReads:
				"`{{base}}.{{first}}` is read after `{{base}}.{{second}}`, reversing the canonical order {{group}}; this looks like inline structural surgery on a domain value. Use a named operation instead of shuffling its fields by hand.",
		},
		schema: [
			{
				type: "object",
				properties: {
					groups: {
						type: "array",
						items: { type: "array", items: { type: "string" }, minItems: 2 },
					},
				},
				additionalProperties: false,
			},
		],
		// Inert until configured: which field pairs have a canonical order is
		// consumer-domain knowledge (e.g. numerator/denominator, startDate/endDate),
		// so no universal default exists.
		defaultOptions: [{ groups: [] }],
	},
	createOnce(context) {
		const option = firstOptionRecord(context.options);
		const groups = (Array.isArray(option.groups) ? option.groups : [])
			.filter(
				(group): group is readonly string[] =>
					Array.isArray(group) && group.every((field) => isString(field)),
			)
			.map((fields) => ({
				order: new Map<string, number>(
					fields.map((field, index): [string, number] => [field, index]),
				),
				label: fields.join(" → "),
		}));

		const checkSequence = (
			node: ESTree.Node,
			parts: ReadonlyArray<{
		expression: ESTree.Expression | ESTree.SpreadElement | null | undefined;
	}>,
		): void => {
			const getText = (target: ESTree.Node): string => context.sourceCode.getText(target);
			const plucks: Array<FieldPluck> = [];
			for (const [position, part] of parts.entries()) {
				const direct = directPluck(part.expression, getText);
				if (direct === null) continue;
				plucks.push({ ...direct, position });
			}
			for (const group of groups) {
				const inGroup = plucks.filter((pluck) => group.order.has(pluck.field));
				for (const later of inGroup) {
					for (const earlier of inGroup) {
						if (earlier.baseText !== later.baseText || earlier.position >= later.position) continue;
						if ((group.order.get(earlier.field) ?? 0) > (group.order.get(later.field) ?? 0)) {
							context.report({
								node,
								messageId: "transposedFieldReads",
								data: {
									base: earlier.baseText,
									first: later.field,
									second: earlier.field,
									group: group.label,
								},
							});
							break;
						}
					}
				}
			}
		};

		return {
			CallExpression(node) {
				checkSequence(node, node.arguments.map((argument) => ({ expression: argument })));
			},
			ObjectExpression(node) {
				checkSequence(
					node,
					node.properties.map((property) =>
						property.type === "Property" ? { expression: property.value } : { expression: undefined },
					),
				);
			},
		};
	},
});
