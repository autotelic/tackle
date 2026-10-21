import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import { firstOptionRecord } from "../../shared/rule-options.ts";

import {
	decodeUiManifest,
	manifestAt,
	type UiManifest,
	type UiPart,
} from "../manifest.ts";

/*
 * A deprecated part is a promise, and an import is the place the promise is checked.
 *
 * Cutlist records `status: deprecated` and `useInstead` in the manifest; this rule reads
 * that record and reports the call sites that have not migrated. It is the lint-shaped
 * half of the same idea as a design system's "preferred instance": the catalog says what
 * replaced the old thing, and the rule makes the old path visible instead of merely
 * documented.
 *
 * The rule fails open. A missing or malformed manifest means no findings, because a lint
 * rule that invents a migration from a file it could not read is worse than one that is
 * briefly quiet; `cutlist build --check` is the gate that makes the manifest current.
 */

const RULE_ID = "plumb-ui/no-deprecated-parts";

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const CACHE = new Map<string, UiManifest | undefined>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manifestFrom(value: unknown): UiManifest | undefined {
	// An inline manifest is what a rule test uses; a path is what a config uses. Both
	// decode through the same reader, so a test cannot pass a shape the real rule rejects.
	if (isRecord(value) && Array.isArray(value.components)) return decodeUiManifest(value);
	if (typeof value !== "string") return undefined;
	if (!CACHE.has(value)) CACHE.set(value, manifestAt(value));
	return CACHE.get(value);
}

/** A module path without its source extension or trailing `/index`. */
function moduleOf(path: string): string {
	return path.replace(/\.(?:tsx?|jsx?)$/u, "").replace(/\/index$/u, "");
}

/**
 * Whether an import specifier names a manifest part.
 *
 * The specifier is resolved by suffix rather than by the repository's alias table: the
 * rule has no tsconfig reader, and every alias in use (`@/`, `~/`, relative) leaves the
 * tail of the path intact. A named import must also match an exported name when the
 * manifest carries one; a default or namespace import matches by path alone.
 */
function namesPart(source: string, imported: string, part: UiPart): boolean {
	const clean = source.replace(/^[.@~]+/u, "").replace(/^\/+/u, "").replace(/\.(?:tsx?|jsx?)$/u, "");
	const target = moduleOf(part.path);
	const pathMatches = target === clean || target.endsWith("/" + clean);
	if (imported === "default" || imported === "*") return pathMatches;
	return pathMatches || (part.exports?.includes(imported) ?? false);
}

/** The imported binding name, or `*` for a namespace import. */
function importedOf(specifier: ESTree.ImportDeclaration["specifiers"][number]): string {
	if (specifier.type === "ImportSpecifier") {
		return specifier.imported.type === "Identifier"
			? specifier.imported.name
			: String(specifier.imported.value);
	}
	if (specifier.type === "ImportDefaultSpecifier") return "default";
	return "*";
}

function localOf(specifier: ESTree.ImportDeclaration["specifiers"][number]): string {
	return specifier.local.name;
}

function deprecatedPartFor(
	manifest: UiManifest,
	source: string,
	imported: string,
): UiPart | undefined {
	return manifest.components.find(
		(part) => part.status === "deprecated" && namesPart(source, imported, part),
	);
}

export const noDeprecatedPartsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Imports from a part whose catalog entry is deprecated must move to its recorded replacement.",
		},
		messages: {
			deprecatedImport:
				"`{{name}}` comes from the deprecated part `{{part}}`; use {{useInstead}} instead.",
			deprecatedWithoutTarget:
				"`{{name}}` comes from the deprecated part `{{part}}`, which records no replacement.",
		},
		schema: [
			{
				type: "object",
				properties: {
					manifest: {
						anyOf: [{ type: "string" }, { type: "object" }],
					},
				},
				additionalProperties: false,
			},
		],
		defaultOptions: [{ manifest: "tools/ui-catalog/plumb-ui.config.json" }],
	},
	createOnce(context) {
		const option = firstOptionRecord(context.options);
		const manifest = manifestFrom(option.manifest);
		if (manifest === undefined) return {};
		const deprecated = manifest.components.filter((part) => part.status === "deprecated");
		if (deprecated.length === 0) return {};

		return {
			before() {
				if (TEST_FILE.test(context.filename.replaceAll("\\", "/"))) return false;
			},
			ImportDeclaration(node) {
				const source = node.source.value;
				if (typeof source !== "string") return;
				for (const specifier of node.specifiers) {
					const imported = importedOf(specifier);
					const part = deprecatedPartFor(manifest, source, imported);
					if (part === undefined) continue;
					const useInstead = part.useInstead ?? [];
					context.report({
						node: specifier,
						messageId:
							useInstead.length === 0 ? "deprecatedWithoutTarget" : "deprecatedImport",
						data: {
							name: localOf(specifier),
							part: part.name,
							useInstead: useInstead.map((name) => `\`${name}\``).join(" or "),
						},
					});
				}
			},
		};
	},
});

export { RULE_ID };
