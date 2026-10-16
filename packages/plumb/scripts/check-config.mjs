#!/usr/bin/env node
/**
 * Guardrails for plumb's own oxlint configuration.
 *
 * Catches the failure modes this repo has actually hit:
 *   1. config references a rule that no plugin ships (stale move/rename)
 *   2. a shipped rule has no config entry (silently unenforced)
 *   3. an entry sits at warn/off without an explicit allow-marker + reason
 *   4. the same rule registered in two plugins
 *   5. jsPlugins specifiers pointing at missing files
 *
 * Severity policy: everything "error" by default. A warn/off entry is allowed
 * only with a trailing marker:  // plumb:allow-warn <reason>
 */
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const PLUGINS = {
	plumb: { entry: "src/index.ts", required: true },
	"plumb-meta": { entry: "src/meta/index.ts", required: true },
	"plumb-effect": { entry: "src/effect/index.ts", required: false },
	"plumb-react": { entry: "src/react/index.ts", required: false },
};

let failures = 0;
const fail = (message) => {
	failures += 1;
	console.error(`  x ${message}`);
};

// --- collect shipped rules per plugin -------------------------------------
async function exists(path) {
	try { await access(path); return true; } catch { return false; }
}

const shipped = new Map(); // plugin -> Set(ruleName)
for (const [plugin, { entry }] of Object.entries(PLUGINS)) {
	const path = join(root, entry);
	if (!(await exists(path))) { fail(`${plugin}: entry file missing (${entry})`); continue; }
	const text = await readFile(path, "utf8");
	const names = [...text.matchAll(/"([a-z0-9-]+)":\s*\w+Rule\b/g)].map((m) => m[1]);
	shipped.set(plugin, new Set(names));
}

// duplicate registration across plugins
const owner = new Map();
for (const [plugin, names] of shipped) {
	for (const name of names) {
		if (owner.has(name)) fail(`rule "${name}" registered in both ${owner.get(name)} and ${plugin}`);
		else owner.set(name, plugin);
	}
}

// --- orphan rule files: exist on disk but never registered -----------------
const entryFiles = {
	plumb: join(root, "src/index.ts"),
	"plumb-meta": join(root, "src/meta/index.ts"),
	"plumb-effect": join(root, "src/effect/index.ts"),
	"plumb-react": join(root, "src/react/index.ts"),
};
const ruleDirs = [
	[join(root, "src/rules"), "plumb"],
	[join(root, "src/effect/rules"), "plumb-effect"],
	[join(root, "src/meta/rules"), "plumb-meta"],
	[join(root, "src/react/rules"), "plumb-react"],
];
for (const [dir, plugin] of ruleDirs) {
	const entryText = await readFile(entryFiles[plugin], "utf8");
	for (const name of await readdir(dir)) {
		if (!name.endsWith(".ts") || name.endsWith(".test.ts") || name === "index.ts") continue;
		const key = name.replace(/\.ts$/, "");
		const fileText = await readFile(join(dir, name), "utf8");
		if (!fileText.includes("defineRule(")) continue;
		if (!entryText.includes(`"${key}":`)) {
			fail(`orphan rule file: ${plugin}/rules/${name} is not registered in the ${plugin} index (silently dead code)`);
		}
	}
}

// --- parse config ----------------------------------------------------------
const configPath = join(root, "oxlint.config.ts");
const configText = await readFile(configPath, "utf8");

const entryRe = /^[ \t]*"(plumb|plumb-effect|plumb-meta|plumb-react)\/([a-z0-9-]+)":\s*"(error|warn|off)"([^\n]*)/gm;
const configured = new Map(); // "plugin/rule" -> {severity, allowMarker, line}
for (const match of configText.matchAll(entryRe)) {
	const [, plugin, rule, severity, rest] = match;
	const key = `${plugin}/${rule}`;
	const allowed = /plumb:allow-(warn|off)/.test(rest);
	configured.set(key, { severity, allowed, plugin, rule });
}

// --- jsPlugins specifiers exist -------------------------------------------
for (const match of configText.matchAll(/specifier:\s*"\.\/(.+?)"/g)) {
	const path = join(root, match[1]);
	if (!(await exists(path))) fail(`jsPlugins specifier target missing: ${match[1]}`);
}

// --- check 1: config keys must be shipped ---------------------------------
for (const key of configured.keys()) {
	const [plugin, rule] = key.split("/");
	if (!shipped.get(plugin)?.has(rule)) fail(`stale config entry: "${key}" is not shipped by ${plugin} (moved or renamed?)`);
}

// --- check 2: shipped required-plugin rules must be configured at error ----
for (const [plugin, names] of shipped) {
	if (!PLUGINS[plugin].required) continue;
	for (const name of names) {
		const key = `${plugin}/${name}`;
		const entry = configured.get(key);
		if (!entry) fail(`unconfigured rule: "${key}" ships but has no config entry (silently unenforced)`);
		else if (entry.severity !== "error" && !entry.allowed)
			fail(`"${key}" is "${entry.severity}" without justification. Add trailing comment: // plumb:allow-${entry.severity} <reason>`);
	}
}

console.log(failures === 0 ? "oxlint config consistent with shipped plugins." : `${failures} config problem(s).`);
process.exit(failures > 0 ? 1 : 0);
