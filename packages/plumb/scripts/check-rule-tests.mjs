#!/usr/bin/env node
/**
 * Verifies every lint rule source file has a co-located <name>.test.ts.
 * File existence is not visible to AST linting, so this lives as a script:
 *   node scripts/check-rule-tests.mjs           report missing suites, exit 0
 *   node scripts/check-rule-tests.mjs --strict  exit 1 when any suite is missing
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = join(fileURLToPath(new URL("..", import.meta.url)), "src");
const strict = process.argv.includes("--strict");

async function listRuleFiles(root) {
	const entries = await readdir(root, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (entry.name === "index.ts" || entry.name.endsWith(".test.ts")) continue;
		files.push(join(root, entry.name));
	}
	return files;
}

const ruleDirs = [join(srcRoot, "rules"), join(srcRoot, "effect", "rules"), join(srcRoot, "meta", "rules"), join(srcRoot, "react", "rules")];
let missing = 0;
for (const dir of ruleDirs) {
	for (const ruleFile of await listRuleFiles(dir)) {
		const testFile = ruleFile.replace(/\.ts$/, ".test.ts");
		try {
			await (await import("node:fs/promises")).stat(testFile);
		} catch {
			missing += 1;
			console.log(`missing suite: ${testFile.replace(srcRoot + "/", "")}`);
		}
	}
}
console.log(missing === 0 ? "all rules have co-located test suites." : `${missing} rule(s) missing test suites.`);
if (strict && missing > 0) process.exit(1);
