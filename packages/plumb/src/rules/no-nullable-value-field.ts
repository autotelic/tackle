import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";
import { isString } from "../shared/structural.ts";
import { inValuesPath } from "../shared/values-path.ts";

/** The constructors that make a value claim the world is uncertain about it. */
const ABSENCE = new Set(["NullOr", "UndefinedOr", "optionalKey"]);

/** Every member name in a schema constructor chain, outermost first.
 *
 * `Schema.NullOr(Schema.String)` has the names `NullOr` and `String`, and
 * `Schema.optionalKey(...)` adds `optionalKey`. The first argument is followed
 * because a wrapper's payload is the next link, not the receiver.
 *
 * @param {ESTree.Node} node - The field's value expression.
 * @returns {ReadonlyArray<string>} The constructor names the chain mentions.
 */
function constructorNames(node: ESTree.Node): ReadonlyArray<string> {
	const names: Array<string> = [];
	const walk = (current: ESTree.Node): void => {
		if (current.type === "CallExpression") {
			const callee = current.callee;
			if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
				names.push(callee.property.name);
			}
			const first = current.arguments[0];
			if (first !== undefined) walk(first);
			return;
		}
		if (current.type === "MemberExpression" && !current.computed && current.property.type === "Identifier") {
			names.push(current.property.name);
			return;
		}
		if (current.type === "TSNonNullExpression") walk(current.expression);
	};
	walk(node);
	return names;
}

/**
 * Whether a constructor chain admits an absent value.
 *
 * @param {ReadonlyArray<string>} names - The names in the field's chain.
 * @returns {boolean} True when one of them makes the field absent.
 */
export function hasAbsence(names: ReadonlyArray<string>): boolean {
	return names.some((entry) => ABSENCE.has(entry));
}

/** The key of an object property, when it is a plain name.
 *
 * @param {ESTree.ObjectProperty} property - The property to read.
 * @returns {string | null} The key, or null for a computed or spread entry.
 */
function propertyKey(property: ESTree.ObjectProperty): string | null {
	if (property.key.type === "Identifier") return property.key.name;
	if (property.key.type === "Literal" && isString(property.key.value)) return property.key.value;
	return null;
}

/**
 * A value is certain, or it is not a value.
 *
 * Nullability from a `left join` is a retrieval artifact. When it becomes a
 * field of the concept, the concept starts saying the business is unsure about
 * something it knows. The partiality belongs in the derivation that read the
 * row, and the exception ("this field is absent by nature") needs a comment.
 */
export const noNullableValueFieldRule = defineRule({
	meta: {
		type: "suggestion",
		docs: {
			description:
				"Disallow nullable or optional Schema.Struct fields inside a declared values path; project the partiality into the derivation instead.",
		},
		messages: {
			nullableValueField:
				"`{{name}}` can be absent inside a value, so the value now claims the business is uncertain. Absence is a property of a projection: project it here, or document why this concept is genuinely partial.",
		},
		schema: [
			{
				type: "object",
				properties: {
					paths: { type: "array", items: { type: "string" } },
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{}],
	},
	createOnce(context) {
		function checkStruct(node: ESTree.CallExpression): void {
			const callee = node.callee;
			if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return;
			if (callee.property.name !== "Struct") return;
			const first = node.arguments[0];
			if (first === undefined || first.type !== "ObjectExpression") return;
			for (const property of first.properties) {
				if (property.type !== "Property") continue;
				const name = propertyKey(property);
				if (name === null) continue;
				const names = constructorNames(property.value);
				if (!hasAbsence(names)) continue;
				context.report({ node: property, messageId: "nullableValueField", data: { name } });
			}
		}

		return {
			before() {
				if (!inValuesPath(context.filename, context.options)) return false;
			},
			CallExpression: checkStruct,
		};
	},
});
