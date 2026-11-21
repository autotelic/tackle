#!/usr/bin/env node
/**
 * Every exported Domain.Rejection has a Story.rejected assertion in the package tests.
 *
 * A rejection with no story is a refusal nobody has seen fail. The check is textual on
 * purpose: the story API is the same in every package, and a missing Story.rejected(new X
 * is the defect, not an AST shape.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "..", "..");
const sources = ["packages/room/src", "packages/mailbox-domain/src"];
const tests = ["packages/room/test", "packages/mailbox-domain/test"];

async function files(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

const rejections = new Set();
for (const source of sources) {
  for (const path of await files(join(root, source))) {
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/class\s+([A-Za-z0-9_]+)\s+extends\s+Domain\.Rejection/gu)) {
      rejections.add(match[1]);
    }
  }
}

const covered = new Set();
for (const test of tests) {
  for (const path of await files(join(root, test))) {
    const text = await readFile(path, "utf8");
    for (const match of text.matchAll(/Story\.rejected\(\s*new\s+([A-Za-z0-9_]+)/gu)) {
      covered.add(match[1]);
    }
  }
}

const missing = [...rejections].filter((name) => !covered.has(name)).sort();
if (missing.length === 0) {
  console.log("rejection stories: ok (" + rejections.size + " rejections)");
} else {
  for (const name of missing) console.log("rejection story missing: " + name);
  process.exit(1);
}
