import { defineRule } from "@oxlint/plugins";

import {
	classifyWideningTarget,
	createTypeEnvironment,
	isKnownEvidenceExpression,
	type TypeEnvironment,
	type WideningTarget,
} from "../shared/dictionary-types.ts";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

import { ancestorsOf } from "../shared/ancestors.ts";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSSatisfiesExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current;
}

function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference,
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
	if (variable.defs.length !== 1) return null;
	const [definition] = variable.defs;
	return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
		? definition.node
		: null;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
	if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
	if (key.type === "Literal") return String(key.value);
	return sourceCode.getText(key);
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
	if (owner === null) return "anonymous function";
	if (owner.id !== null) return owner.id.name;
	const parent = ancestorsOf(sourceCode, owner).at(-1);
	if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier")
		return parent.id.name;
	if (parent?.type === "MethodDefinition") return sourceKeyName(sourceCode, parent.key);
	return "anonymous function";
}

function hasParentAssertion(sourceCode: SourceCode, node: ESTree.Node): boolean {
	const parent = ancestorsOf(sourceCode, node).at(-1);
	return parent?.type === "TSAsExpression" || parent?.type === "TSTypeAssertion";
}

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
export const noKnownValueWideningRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow syntactically established values from flowing into explicitly broad or anonymous target types that discard useful evidence.",
		},
		messages: {
			widening:
				"The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
		},
	},
	createOnce(context) {
		let environment: TypeEnvironment | null = null;

		const reportFlow = (
			expression: ESTree.Expression,
			destination: WideningTarget | null,
			subject: string,
		) => {
			if (destination === null) return;
			const unwrapped = unwrapExpression(expression);
			const accumulator =
				destination.kind === "open dictionary" || destination.kind === "generic container";
			if (
				accumulator &&
				unwrapped.type === "ObjectExpression" &&
				unwrapped.properties.length === 0
			) {
				return;
			}
			const visit = (expression: ESTree.Expression, visitedVariables: Set<Variable>): boolean => {
				if (isKnownEvidenceExpression(expression)) return true;
				const unwrapped = unwrapExpression(expression);
				if (unwrapped.type !== "Identifier") return false;
				const variable = resolveVariable(context.sourceCode, unwrapped);
				if (variable === null || visitedVariables.has(variable)) return false;
				const declarator = variableDeclarator(variable);
				if (declarator === null || declarator.init === null) return false;
				const declaration = ancestorsOf(context.sourceCode, declarator).at(-1);
				const stableConst =
					declaration?.type === "VariableDeclaration" &&
					declaration.kind === "const" &&
					variable.references.every((reference) => reference.init || !reference.isWrite());
				if (!stableConst) return false;
				visitedVariables.add(variable);
				return visit(declarator.init, visitedVariables);
			};
			if (!visit(expression, new Set<Variable>())) return;
			context.report({
				node: expression,
				messageId: "widening",
				data: { subject, target: destination.kind },
			});
		};

		const targetFromAnnotation = (
			annotation: ESTree.TSTypeAnnotation | null | undefined,
		): WideningTarget | null =>
			environment === null || annotation === null || annotation === undefined
				? null
				: classifyWideningTarget(annotation.typeAnnotation, environment);

		return {
			Program(node) {
				environment = createTypeEnvironment(node);
			},
			VariableDeclarator(node) {
				if (node.init === null || node.id.type !== "Identifier") return;
				reportFlow(
					node.init,
					targetFromAnnotation(node.id.typeAnnotation),
					`binding \`${node.id.name}\``,
				);
			},
			PropertyDefinition(node) {
				if (node.value === null) return;
				reportFlow(
					node.value,
					targetFromAnnotation(node.typeAnnotation),
					`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
				);
			},
			AccessorProperty(node) {
				if (node.value === null) return;
				reportFlow(
					node.value,
					targetFromAnnotation(node.typeAnnotation),
					`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
				);
			},
			AssignmentExpression(node) {
				if (node.operator !== "=" || node.left.type !== "Identifier") return;
				const variable = resolveVariable(context.sourceCode, node.left);
				if (variable === null) return;
				const declarator = variableDeclarator(variable);
				if (declarator === null || declarator.id.type !== "Identifier") return;
				reportFlow(
					node.right,
					targetFromAnnotation(declarator.id.typeAnnotation),
					`binding \`${declarator.id.name}\``,
				);
			},
			ReturnStatement(node) {
				if (node.argument === null) return;
				let owner: FunctionExpression | null = null;
				const ancestors = ancestorsOf(context.sourceCode, node);
				for (let index = ancestors.length - 1; index >= 0; index--) {
					const current = ancestors[index]!;
					if (current.type === "Program") break;
					if (
						current.type === "ArrowFunctionExpression" ||
						current.type === "FunctionDeclaration" ||
						current.type === "FunctionExpression"
					) {
						owner = current;
						break;
					}
				}
				reportFlow(
					node.argument,
					targetFromAnnotation(owner?.returnType),
					`return value of \`${functionName(context.sourceCode, owner)}\``,
				);
			},
			ArrowFunctionExpression(node) {
				if (node.body.type === "BlockStatement") return;
				reportFlow(
					node.body,
					targetFromAnnotation(node.returnType),
					`return value of \`${functionName(context.sourceCode, node)}\``,
				);
			},
			TSAsExpression(node) {
				if (environment === null || hasParentAssertion(context.sourceCode, node)) return;
				reportFlow(
					node.expression,
					classifyWideningTarget(node.typeAnnotation, environment),
					"assertion",
				);
			},
			TSTypeAssertion(node) {
				if (environment === null || hasParentAssertion(context.sourceCode, node)) return;
				reportFlow(
					node.expression,
					classifyWideningTarget(node.typeAnnotation, environment),
					"assertion",
				);
			},
		};
	},
});
