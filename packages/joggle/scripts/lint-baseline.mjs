/**
 * A ratchet for plumb's findings, in the repository rather than in the tool.
 *
 * `oxlint` has no baseline, so adopting plumb on an existing codebase means either
 * fixing 871 findings first or turning it off. Both are the same outcome: the
 * rules never run. A baseline is the third option -- everything already there is
 * known, everything new fails -- and it is what makes a rule adoptable at all.
 *
 * The identity is the rule, the file and the message, and never the line number.
 * Code moves constantly, and a baseline that reports every edit as a new finding
 * is a baseline nobody reads. joggle's baseline works the same way and for the
 * same reason.
 *
 *   pnpm lint          fail on anything not in the baseline
 *   pnpm lint:update   accept the current state as the baseline
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASELINE = "lint-baseline.json";
const update = process.argv.includes("--update");

/** Every finding, from the JSON oxlint prints even when it exits non-zero. */
const findings = () => {
  const args = ["--config", "oxlint.config.ts", "--format", "json", "src"];
  let stdout = "";
  try {
    stdout = execFileSync("oxlint", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    // Findings are a non-zero exit AND a complete report. Only a failure with no
    // report is a failure.
    stdout = typeof error.stdout === "string" ? error.stdout : "";
    if (stdout.trim() === "") throw error;
  }
  const decoded = JSON.parse(stdout);
  return Array.isArray(decoded.diagnostics) ? decoded.diagnostics : [];
};

const identityOf = (diagnostic) =>
  [diagnostic.code, diagnostic.filename, diagnostic.message].join("\u0000");

/**
 * Identity to COUNT, not a list.
 *
 * Forty stray-comment findings in one file share one identity, because the
 * message is the same. A list would collapse them into one entry and then fail to
 * notice a forty-first; a count notices, and a count that falls is work done.
 */
const censusOf = (diagnostics) => {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    const identity = identityOf(diagnostic);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
};

const all = findings();
const now = censusOf(all);

if (update || !existsSync(BASELINE)) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note: "Known plumb findings, by identity and count. `pnpm lint:update` accepts the current state; `pnpm lint` fails when a count rises or a new identity appears.",
        total: all.length,
        census: now,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    (update ? "Updated" : "Wrote") + " the baseline: " + all.length + " known finding(s).",
  );
  process.exit(0);
}

const known = JSON.parse(readFileSync(BASELINE, "utf8")).census ?? {};
const added = [];
for (const [identity, count] of Object.entries(now)) {
  if ((known[identity] ?? 0) < count) added.push(identity);
}
let fixed = 0;
for (const [identity, count] of Object.entries(known)) {
  fixed += Math.max(0, count - (now[identity] ?? 0));
}

for (const identity of added) {
  const [code, file, message] = identity.split("\u0000");
  console.log("error " + code + " in " + file + ": " + message);
}

console.log(
  "\n" +
    all.length +
    " findings, " +
    added.length +
    " new, " +
    fixed +
    " fixed since the baseline.",
);
if (added.length > 0) {
  console.log("Fix them, or run `pnpm lint:update` to accept them deliberately.");
  process.exit(1);
}
