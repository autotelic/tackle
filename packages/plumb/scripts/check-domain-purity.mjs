#!/usr/bin/env node
/**
 * Domain packages import only effect, @alchemy.run/domain, pure JSON, and their own files.
 *
 * This is a package-level rule: an AST linter sees one file, but purity is a property of the
 * tree. It exists because two time sources and an IO provider moved into a domain during this
 * work; the answer to a violation is a port, not a disable.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..");
const domainRoots = [
  "packages/room/src/Room",
  "packages/room/src/Move",
];
const allowed = (specifier) =>
  specifier.startsWith(".") ||
  specifier === "effect" ||
  specifier.startsWith("effect/") ||
  specifier === "@alchemy.run/domain" ||
  specifier === "safe-stable-stringify";
const forbiddenText = [
  { pattern: /Date\.now\s*\(/u, message: "Date.now() reads the wall clock" },
  { pattern: /new Date\(\s*\)/u, message: "new Date() reads the wall clock" },
  { pattern: /process\.env/u, message: "process.env reads the environment" },
  { pattern: /\bfetch\s*\(/u, message: "fetch() performs IO" },
  { pattern: /from ["']node:/u, message: "node: imports perform IO" },
];
const violations = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const text = await readFile(path, "utf8");
    for (const line of text.split("\n")) {
      const match = /from\s+["']([^"']+)["']/u.exec(line);
      if (match !== null && !allowed(match[1])) {
        violations.push(path + ": import " + match[1]);
      }
    }
    for (const { pattern, message } of forbiddenText) {
      if (pattern.test(text)) violations.push(path + ": " + message);
    }
  }
}
for (const relative of domainRoots) {
  await walk(join(root, relative));
}
if (violations.length === 0) {
  console.log("domain purity: ok");
} else {
  for (const violation of violations) console.log("domain purity: " + violation);
  process.exit(1);
}
