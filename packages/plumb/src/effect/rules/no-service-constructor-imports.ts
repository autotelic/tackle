import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const SERVICE_CONSTRUCTOR_NAME = /^make[A-Z]/u;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

/** Keep dependency-bearing Effect service constructors local to their owning capability modules. */
export const noServiceConstructorImportsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow project-local make<CapabilityName> imports outside test and spec files.",
		},
		messages: {
			serviceConstructorImport:
				'Do not import Effect service constructor "{{name}}" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.',
		},
	},
	createOnce(context) {
		let isTestFile = false;

		return {
			before() {
				isTestFile = TEST_FILE.test(context.filename.replaceAll("\\", "/"));
			},
			ImportDeclaration(node) {
				const source = node.source.value;
				if (isTestFile || !(source.startsWith("./") || source.startsWith("../"))) return;

				for (const specifier of node.specifiers) {
					if (specifier.type !== "ImportSpecifier") continue;

					const importedName =
						specifier.imported.type === "Identifier"
							? specifier.imported.name
							: specifier.imported.value;
					if (!SERVICE_CONSTRUCTOR_NAME.test(importedName)) continue;

					context.report({
						node: specifier,
						messageId: "serviceConstructorImport",
						data: { name: importedName },
					});
				}
			},
		};
	},
});
