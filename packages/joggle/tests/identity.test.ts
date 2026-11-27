import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { dependentsOf } from "../src/dependents.ts"
import { fragmentsOf } from "../src/fragments.ts"
import { identityOf } from "../src/identity.ts"
import { loadWorkspace, type Unit, type Workspace } from "../src/workspace.ts"

const workspaceOf = (files: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const root = mkdtempSync(join(tmpdir(), "joggle-identity-"))
    for (const [name, text] of Object.entries(files)) {
      const file = join(root, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
    }
    return yield* loadWorkspace(root, ["."])
  }).pipe(Effect.provide(NodeServices.layer))

const idsByName = (workspace: Workspace): ReadonlyMap<string, string> => {
  const out = new Map<string, string>()
  for (const { unit, id } of identityOf(workspace).declarations) out.set(unit.name, id)
  return out
}

const unitNamed = (workspace: Workspace, name: string): Unit => {
  const unit = workspace.units.find((candidate) => candidate.name === name)
  if (unit === undefined) throw new Error("the fixture declares " + name)
  return unit
}

it.effect("the two version files — containment 1.00 by token bag — share every id", () =>
  Effect.gen(function* () {
    const root = resolve(import.meta.dirname, "../../..")
    const workspace = yield* loadWorkspace(root, [
      "packages/jig-cli/src/version.ts",
      "packages/cutlist/src/version.ts",
    ])
    const jig = identityOf(workspace).declarations.filter(({ unit }) =>
      unit.file.startsWith("packages/jig-cli/"),
    )
    const cutlist = identityOf(workspace).declarations.filter(({ unit }) =>
      unit.file.startsWith("packages/cutlist/"),
    )
    expect(jig.length).toBeGreaterThan(0)
    expect(cutlist.length).toBe(jig.length)
    for (const { unit, id } of jig) {
      const twin = cutlist.find((entry) => entry.unit.name === unit.name)
      expect(twin?.id).toBe(id)
    }
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("the declared name is not an input: two files, one body, one id", () =>
  Effect.gen(function* () {
    // The whole identity layer exists for this. Only the declared name differs --
    // including the space `beta (` leaves where `alpha(` had none -- and a rename
    // must not re-open the ledger or the baseline.
    const workspace = yield* workspaceOf({
      "src/a.ts": "export function alpha(x: number) { const total = x + 1; return total }\n",
      "src/b.ts": "export function beta (x: number) { const total = x + 1; return total }\n",
    })
    const alpha = identityOf(workspace).ids.get(unitNamed(workspace, "alpha"))
    const beta = identityOf(workspace).ids.get(unitNamed(workspace, "beta"))
    expect(alpha).toBeDefined()
    expect(beta).toBe(alpha)

    const changed = yield* workspaceOf({
      "src/a.ts": 'export function alpha(x: number) { const total = x + 1; return "" + total }\n',
      "src/b.ts": "export function beta (x: number) { const total = x + 1; return total }\n",
    })
    expect(identityOf(changed).ids.get(unitNamed(changed, "alpha"))).not.toBe(beta)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("a renamed function and local keep the id; a changed string does not", () =>
  Effect.gen(function* () {
    const before = yield* workspaceOf({
      "src/version.ts":
        'export function greet(name: string) { const greeting = "hi"; return greeting + name }\n',
    })
    const after = yield* workspaceOf({
      "src/version.ts":
        'export function welcome(who: string) { const hello = "hi"; return hello + who }\n',
    })
    const changed = yield* workspaceOf({
      "src/version.ts":
        'export function greet(name: string) { const greeting = "hi!"; return greeting + name }\n',
    })
    const first = idsByName(before).get("greet")
    expect(first).toBeDefined()
    expect(idsByName(after).get("welcome")).toBe(first)
    expect(idsByName(changed).get("greet")).not.toBe(first)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("reordering a mutually recursive pair changes neither id", () =>
  Effect.gen(function* () {
    const a = "const a = (n: number): number => (n <= 0 ? 0 : b(n - 1))\n"
    const b = "const b = (n: number): number => a(n)\n"
    const one = yield* workspaceOf({ "src/pair.ts": a + b })
    const two = yield* workspaceOf({ "src/pair.ts": b + a })
    const first = idsByName(one)
    const second = idsByName(two)
    expect(first.get("a")).toBe(second.get("a"))
    expect(first.get("b")).toBe(second.get("b"))
    expect(first.get("a")).not.toBe(first.get("b"))
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("fragments are distinct and complete", () =>
  Effect.gen(function* () {
    const workspace = yield* workspaceOf({
      "src/f.ts": "export const run = (n: number) => n <= 0 ? 0 : run(n - 1)\n",
    })
    const fragments = fragmentsOf(unitNamed(workspace, "run"))
    expect(fragments.ids.length).toBeGreaterThan(0)
    expect(new Set(fragments.ids).size).toBe(fragments.ids.length)
    expect(fragments.cut).toBe(false)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("the reverse index names the declarations that call another", () =>
  Effect.gen(function* () {
    const workspace = yield* workspaceOf({
      "src/calls.ts": "const b = () => 1\nconst a = () => b()\nconst c = () => b()\n",
    })
    const dependents = dependentsOf(workspace)
    const id = identityOf(workspace).ids.get(unitNamed(workspace, "b"))
    expect(id).toBeDefined()
    const callers = (dependents.get(id ?? "") ?? []).map((unit) => unit.name).sort()
    expect(callers).toEqual(["a", "c"])
  }).pipe(Effect.provide(NodeServices.layer)),
)
