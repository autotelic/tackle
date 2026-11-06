import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { loadDeclarationTypes, resolveDeclarations } from "../src/typefacts.ts"
import type { ResolvedType } from "../src/typefacts.ts"
import { Option } from "effect"
import { checkRepository } from "../src/check.ts"
import { layer as decisionLayer } from "../src/decision.ts"
import { builtIn } from "../src/rules/index.ts"
import { nodeLayer, tsgoStub } from "./support.ts"

const file = "tests/fixtures/node-types/src/facts.ts"
const tsconfig = "tests/fixtures/node-types/tsconfig.json"
const text = readFileSync(file, "utf8")

/** The offset of a declaration's NAME: hover resolves this token, not the start. */
const nameAt = (declaration: string, name: string): number => {
  const start = text.indexOf(declaration)
  if (start === -1) throw new Error("declaration not found: " + declaration)
  return start + declaration.indexOf(name)
}

const positions = (entries: ReadonlyArray<readonly [string, string]>) =>
  entries.map(([declaration, name]) => ({ file, position: nameAt(declaration, name) }))

const factsOf = (found: ReadonlyArray<{ file: string; position: number; facts: ResolvedType }>, position: number) => {
  const entry = found.find((candidate) => candidate.position === position)
  if (entry === undefined) throw new Error("no facts at " + String(position))
  return entry.facts
}

const member = (facts: ResolvedType, name: string): string | undefined =>
  facts.members.find((entry) => entry.name === name)?.type

describe("the declaration fact layer", () => {
  it(
    "resolves a member's own type, through composition, aliasing and indexed access",
    async () => {
      const requests = positions([
        ["interface Composed", "Composed"],
        ["type Picked", "Picked"],
        ["type Variants", "Variants"],
        ["const ROLES", "ROLES"],
        ["const KIND", "KIND"],
        ["interface Alpha", "Alpha"],
        ["interface Beta", "Beta"],
        ["interface Wide", "Wide"],
        ["interface Narrow", "Narrow"],
        ["interface Derived", "Derived"],
        ["type Alias", "Alias"],
        ["type Wrapped", "Wrapped"],
      ])
      const result = await resolveDeclarations({
        cwd: process.cwd(),
        tsconfig,
        requests,
        maxMembers: 64,
        maxStrings: 12000,
      })
      expect(result.unresolved).toBe(0)
      expect(result.found.length).toBe(requests.length)

      const composed = factsOf(result.found, requests[0]?.position ?? -1)
      // The composition, the alias and the member's own resolved type all survive.
      expect(member(composed, "base")).toBe("Base")
      expect(member(composed, "pair")).toContain("Base")
      expect(member(composed, "pair")).toContain("extra")
      expect(member(composed, "optional")).toBe("Partial<Base>")
      expect(composed.structural).toContain("optional:Partial<Base>")

      // Indexed access is resolved, which is the fact the trace cannot carry.
      const picked = factsOf(result.found, requests[1]?.position ?? -1)
      expect(member(picked, "label")).toBe("string")
      expect(member(picked, "id")).toBe("string")

      // A union is variants, not an empty field set.
      const variants = factsOf(result.found, requests[2]?.position ?? -1)
      expect(variants.flags).toContain("Union")
      expect(variants.variants.length).toBe(2)
      expect(variants.structural.startsWith("union(")).toBe(true)

      // A tuple constant keeps its members to the runtime, but still has a type.
      const roles = factsOf(result.found, requests[3]?.position ?? -1)
      expect(roles.display).toContain("readonly")
      expect(roles.members).toEqual([])

      // A literal keeps its value, which is the start of a value-set fact.
      const kind = factsOf(result.found, requests[4]?.position ?? -1)
      expect(kind.value).toBe("admin")

      // Identical structure is one group, whatever the declarations are called.
      const alpha = factsOf(result.found, requests[5]?.position ?? -1)
      const beta = factsOf(result.found, requests[6]?.position ?? -1)
      expect(alpha.identicalGroup).not.toBeNull()
      expect(alpha.identicalGroup).toBe(beta.identicalGroup)

      // A subset is not an identical group: one can be assigned to the other,
      // not both ways.
      const wide = factsOf(result.found, requests[7]?.position ?? -1)
      const narrow = factsOf(result.found, requests[8]?.position ?? -1)
      expect(wide.identicalGroup).toBeNull()
      expect(narrow.identicalGroup).toBeNull()

      // A base is a fact, and it is the checker's: the members include what the
      // interface inherits, and the base is named separately.
      const derived = factsOf(result.found, requests[9]?.position ?? -1)
      expect(derived.bases).toEqual(["Base"])
      expect(derived.members.map((entry) => entry.name)).toContain("id")
      expect(derived.structural).toBe("object{extra:boolean;id:string;label:string}")

      // An alias target resolves to what it names, and an alias the checker keeps
      // is named so a question can point at it.
      const alias = factsOf(result.found, requests[10]?.position ?? -1)
      expect(alias.display).toBe("Base")
      const wrapped = factsOf(result.found, requests[11]?.position ?? -1)
      expect(wrapped.alias).toBe("Wrapped")
      expect(member(wrapped, "value")).toBe("Base")
    },
    120000,
  )

  it(
    "stores the facts keyed by the run manifest, and answers the second run from the cache",
    () =>
      Effect.gen(function* () {
        const cacheDir = mkdtempSync(join(tmpdir(), "joggle-decl-facts-"))
        const requests = positions([["interface Composed", "Composed"]])
        const input = {
          root: process.cwd(),
          cacheDir,
          tool: "test",
          manifest: "manifest-a",
          tsconfig,
          requests,
          maxMembers: 64,
          maxStrings: 12000,
        } as const
        const first = yield* loadDeclarationTypes(input)
        expect(first.loadedFrom).toBe("checker")
        expect(first.index.size).toBe(1)
        const second = yield* loadDeclarationTypes(input)
        expect(second.loadedFrom).toBe("cache")
        expect(second.index.size).toBe(1)

        // A different manifest is a different program: the cache is not borrowed.
        const third = yield* loadDeclarationTypes({ ...input, manifest: "manifest-b" })
        expect(third.loadedFrom).toBe("checker")
      }).pipe(Effect.provide(NodeServices.layer)),
    120000,
  )
})

describe("the engine", () => {
  it.effect(
    "resolves declaration types by default, with no --types flag",
    () =>
      Effect.gen(function* () {
        const report = yield* checkRepository({
          cwd: "tests/fixtures/node-types",
          paths: ["src"],
          rules: ["joggle/import-cycle"],
          typecheck: false,
          types: "off",
          useTsgo: true,
          cacheDirExplicit: true,
          cacheDir: mkdtempSync(join(tmpdir(), "joggle-decl-run-")),
          replayUnchanged: false,
          changed: false,
          baselinePath: undefined,
          updateBaselinePath: undefined,
          config: {},
        })
        const note = report.notes.find((entry) => entry.reason.startsWith("resolved "))
        expect(note).toBeDefined()
        expect(note?.reason).toContain("declaration(s) to a type")
        expect(note?.reason).not.toContain("resolved 0 of")
      }).pipe(
        Effect.provide(decisionLayer({ cacheDir: mkdtempSync(join(tmpdir(), "joggle-decl-dec-")), offline: true, apiKey: Option.none() })),
        Effect.provide(tsgoStub),
        Effect.provide(builtIn),
        Effect.provide(nodeLayer),
      ),
    120000,
  )
})
