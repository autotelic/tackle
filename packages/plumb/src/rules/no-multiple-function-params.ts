import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import { readField } from "../shared/structural.ts";

import { ancestorsOf } from "../shared/ancestors.ts";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const DEFAULT_MAX_PARAMS = 1;

/** Conventional HTTP method handler names, exempt inside framework route files. */
const HTTP_METHOD_NAMES = new Set([
	"DELETE",
	"GET",
	"HEAD",
	"OPTIONS",
	"PATCH",
	"POST",
	"PUT",
]);

const DEFAULT_ROUTE_BASENAMES = new Set(["route.ts", "route.tsx"]);

interface Options {
	readonly exemptFunctionNames?: ReadonlyArray<string>;
	readonly exemptRouteBasenames?: ReadonlyArray<string>;
}

/** Structural view of a function-like visitor node. */
interface FunctionLike {
	readonly params: ReadonlyArray<ESTree.ParamPattern>;
}

function parentOf(sourceCode: SourceCode, node: ESTree.Node): ESTree.Node | null {
	return ancestorsOf(sourceCode, node).at(-1) ?? null;
}

/**
 * Functions the module owns: declarations and named bindings, not callbacks.
 *
 * A function nested inside another function is a closure — its arity is local, not part of
 * the module's surface, so the rule does not apply. (`ancestorsOf` is outermost-first.)
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ESTree.Node} node - The visited function-like node.
 * @returns {boolean} True when the module owns the function's arity.
 */
function isOwnedFunction(sourceCode: SourceCode, node: ESTree.Node): boolean {
	const chain = ancestorsOf(sourceCode, node);
	const nested = chain.some(
		(ancestor) =>
			ancestor.type === "FunctionDeclaration" ||
			ancestor.type === "FunctionExpression" ||
			ancestor.type === "ArrowFunctionExpression",
	);
	if (nested) return false;
	if (node.type === "FunctionDeclaration") return true;
	const parent = chain.at(-1) ?? null;
	if (parent === null) return false;
	const parentType = parent.type;
	if (
		parentType === "CallExpression" ||
		parentType === "NewExpression" ||
		parentType === "JSXExpressionContainer"
	) {
		return false;
	}
	return (
		parentType === "VariableDeclarator" ||
		parentType === "AssignmentExpression" ||
		parentType === "ExportDefaultDeclaration"
	);
}

interface ResolvedOptions {
	methodNames: ReadonlySet<string>;
	routeBasenames: ReadonlySet<string>;
}

/**
 * Exported HTTP-method-named handlers in framework route files own their arity.
 *
 * @param {{ options: ResolvedOptions; baseName: string; sourceCode: SourceCode; node: ESTree.Node }} payload - Exemption inputs.
 * @returns {boolean} True when the handler is an exempt route handler.
 */
function isExemptRouteHandler(payload: {
	options: ResolvedOptions;
	baseName: string;
	sourceCode: SourceCode;
	node: ESTree.Node;
}): boolean {
	if (payload.node.type !== "FunctionDeclaration") return false;
	const name = payload.node.id?.name;
	if (name === undefined || !payload.options.methodNames.has(name)) return false;
	if (!payload.options.routeBasenames.has(payload.baseName)) return false;
	const parent = parentOf(payload.sourceCode, payload.node);
	return parent !== null && parent.type === "ExportNamedDeclaration";
}

/**
 * Whether every positional parameter carries a distinct annotated type: transposing such
 * arguments is a compile error, so ordering needs no guard. Distinctness is the test, not
 * primitive-versus-structural: `(name: string, count: number)` is as safe as
 * `(left: Node, right: Node)` is unsafe, and only a repeated type transposes silently.
 *
 * A default value wraps the identifier in an `AssignmentPattern`; the annotation lives on
 * the left. Treating a defaulted parameter as unannotated made every function with a default
 * look unsafe.
 *
 * @param {SourceCode} sourceCode - The rule's source-code accessor.
 * @param {ReadonlyArray<ESTree.ParamPattern>} params - The parameter list to inspect.
 * @returns {boolean} True when transposing any pair fails the compiler.
 */
function transpositionSafe(
	sourceCode: SourceCode,
	params: ReadonlyArray<ESTree.ParamPattern>,
): boolean {
	const texts: Array<string> = [];
	for (const param of params) {
		const identifier = param.type === "AssignmentPattern" ? param.left : param;
		if (identifier.type !== "Identifier") return false;
		const annotation = identifier.typeAnnotation;
		if (annotation === null || annotation === undefined) return false;
		const text = sourceCode.getText(annotation.typeAnnotation).replaceAll(" ", "");
		if (text === "") return false;
		texts.push(text);
	}
	return new Set(texts).size === texts.length;
}

/** Owned functions taking several positional inputs accept transposed arguments silently; require one payload object. */
export const noMultipleFunctionParamsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow owned functions with more than one positional parameter unless every parameter has a distinct annotated type; collapse multiple inputs into a single named payload object so a transposed argument fails the compiler.",
		},
		messages: {
			multipleParams:
				"`{{name}}` takes {{count}} positional parameters without distinct types. Accept a single named payload object instead; two parameters of the same type transpose silently.",
		},
	},
	createOnce(context) {
		const rawOptions = readField<ReadonlyArray<Options>>(context, "options");
		const options: ResolvedOptions = {
			methodNames: new Set(rawOptions?.[0]?.exemptFunctionNames ?? HTTP_METHOD_NAMES),
			routeBasenames: new Set(
				rawOptions?.[0]?.exemptRouteBasenames ?? DEFAULT_ROUTE_BASENAMES,
			),
		};
		let fileBase = "";
		const check = (node: ESTree.Node): void => {
			if (
				node.type !== "FunctionDeclaration" &&
				node.type !== "FunctionExpression" &&
				node.type !== "ArrowFunctionExpression"
			)
				return;
			const fn = node;
			if (fn.params.length <= DEFAULT_MAX_PARAMS) return;
			if (!isOwnedFunction(context.sourceCode, node)) return;
			if (transpositionSafe(context.sourceCode, fn.params)) return;
			if (
				isExemptRouteHandler({
					options,
					baseName: fileBase,
					sourceCode: context.sourceCode,
					node,
				})
			)
				return;
			let name = "(anonymous)";
			if (node.id !== null && node.id !== undefined) {
				name = node.id.name;
			} else {
				const parent = parentOf(context.sourceCode, node);
				if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
					name = parent.id.name;
				} else if (
					parent?.type === "AssignmentExpression" &&
					parent.left.type === "Identifier"
				) {
					name = parent.left.name;
				}
			}
			context.report({
				node,
				messageId: "multipleParams",
				data: { name, count: String(fn.params.length) },
			});
		};
		return {
			before() {
				const normalized = context.filename.replaceAll("\\", "/");
				const segments = normalized.split("/");
				fileBase = segments[segments.length - 1] ?? normalized;
				if (TEST_FILE.test(normalized)) return false;
			},
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
		};
	},
});
