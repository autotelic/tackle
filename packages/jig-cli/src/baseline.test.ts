/* oxlint-disable plumb/prefer-property-tests -- the ledger's identity rule is asserted against a fixed report; a generator would need the hashing under test to know what to expect. */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/*
 * `jig baseline` must not accept what it cannot name the way a judged run would.
 *
 * An engine that could not verify a finding names it from what it could see, and a judged
 * run can name the same finding from the cluster: two identities for one thing. A ledger
 * written from the first is silently useless against the second — the repository is green
 * locally and red in CI, and both runs "passed" their own. The refusal and the
 * `--allow-unjudged` override are the contract; this runs the real CLI to hold it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const cliSource = resolve(here, "cli.ts")

interface Repo {
  readonly root: string
  readonly jig: string
}

/** A repo whose one engine reports a single finding and takes its judged flag from argv. */
const repoWith = (judged: boolean, gate: Record<string, unknown> = {}): Repo => {
  const root = mkdtempSync(join(tmpdir(), "jig-baseline-"))
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "src/a.ts"), "export const a = 1\n")
  writeFileSync(
    join(root, "engine.mjs"),
    `console.log(JSON.stringify({ diagnostics: [{ ruleId: "x", severity: "error", message: "m", file: "src/a.ts", line: 1, column: 1, identity: "fake/x:src/a.ts", ${judged ? "" : "judged: false,"} }] }))\n`,
  )
  writeFileSync(
    join(root, "jig.config.json"),
    `${JSON.stringify(
      {
        engines: [{ id: "fake", kind: "process", command: process.execPath, args: ["engine.mjs"] }],
        gate: { mode: "all", baseline: ".jig-baseline.json", failOn: "any-new", ...gate },
      },
      null,
      2,
    )}\n`,
  )
  return { root, jig: cliSource }
}

const run = (repo: Repo, args: ReadonlyArray<string>) =>
  spawnSync(process.execPath, ["--conditions=development", repo.jig, ...args], {
    cwd: repo.root,
    encoding: "utf8",
  })

describe("a check never edits the tree it judges", () => {
  it("runs every engine with JIG_READ_ONLY set", () => {
    const root = mkdtempSync(join(tmpdir(), "jig-readonly-"))
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src/a.ts"), "export const a = 1\n")
    // The engine reports the variable it was given: this is the contract a writing engine
    // (joggle) honours, and the reason a check cannot append to .joggle/answers.jsonl.
    writeFileSync(
      join(root, "engine.mjs"),
      'console.log(JSON.stringify({ diagnostics: [{ ruleId: "x", severity: "warn", message: "read-only=" + (process.env.JIG_READ_ONLY ?? "unset"), file: "src/a.ts", line: 1, column: 1, identity: "fake/x:src/a.ts" }] }))\n',
    )
    writeFileSync(
      join(root, "jig.config.json"),
      JSON.stringify({
        engines: [{ id: "fake", kind: "process", command: process.execPath, args: ["engine.mjs"] }],
        gate: { mode: "all", baseline: ".jig-baseline.json", failOn: "any-new" },
      }),
    )
    const result = run({ root, jig: cliSource }, ["check"])
    expect(result.stdout).toContain("read-only=1")
  })
})

describe("jig baseline and unjudged findings", () => {
  it("refuses to accept a finding no judgement reached, and names the key", () => {
    const repo = repoWith(false)
    const result = run(repo, ["baseline"])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("refusing to accept 1 unverified finding(s)")
    expect(result.stdout).toContain("TYPESAFE_API_KEY")
    expect(result.stdout).toContain("--allow-unjudged")
    expect(existsSync(join(repo.root, ".jig-baseline.json"))).toBe(false)
  })

  it("accepts it under --allow-unjudged and says the identities may not hold", () => {
    const repo = repoWith(false)
    const result = run(repo, ["baseline", "--allow-unjudged"])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("1 of them were unverified")
    const ledger = JSON.parse(readFileSync(join(repo.root, ".jig-baseline.json"), "utf8"))
    expect(ledger.identities).toEqual(["fake/x:src/a.ts"])
  })

  it("says so, and exits as check would, when the gate ignores the ledger", () => {
    const repo = repoWith(false, { failOn: "warn" })
    const result = run(repo, ["baseline", "--allow-unjudged"])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("accepted, but the gate still holds 1 of these finding(s)")
    expect(result.stdout).toContain('failOn "warn" holds by severity')
  })

  it("exits clean when the accepted findings are the only ones", () => {
    const repo = repoWith(false)
    expect(run(repo, ["baseline", "--allow-unjudged"]).status).toBe(0)
  })
})
