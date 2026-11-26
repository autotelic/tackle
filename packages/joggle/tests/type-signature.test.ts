import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { loadWorkspace } from "../src/workspace.ts"

/**
 * `typeSignature` is the key `duplicate-implementation` joins on, so what it
 * contains decides whether two identical helpers can ever be one finding.
 *
 * An imported name resolves to the file that exports it, a locally declared name
 * keeps its own file, and a name the file neither imports nor declares -- a
 * global such as `ReadonlyArray`, or a package type -- resolves to the BARE name.
 * The old fallback qualified everything by the referring file, which gave two
 * identical helpers in different files different signatures; the shape join then
 * found nothing, and `duplicate-implementation` reported zero on this repository.
 */
const fixture = () => loadWorkspace("tests/fixtures/signature", ["src"])

const signatureOf = (units: ReadonlyArray<{ readonly name: string; readonly typeSignature: string }>, name: string): string | undefined =>
  units.find((unit) => unit.name === name)?.typeSignature

it.effect("a global type resolves to its bare name, so two files can agree", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const first = signatureOf(workspace.units, "first")
    const second = signatureOf(workspace.units, "second")
    expect(first).toBe(second)
    expect(first).not.toContain(".ts")
    expect(first).toContain("ReadonlyArray")
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("a locally declared type keeps its file as identity", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const a = signatureOf(workspace.units, "readA")
    const b = signatureOf(workspace.units, "readB")
    expect(a).not.toBe(b)
    expect(a).toContain("local-a.ts#Payload")
    expect(b).toContain("local-b.ts#Payload")
  }).pipe(Effect.provide(NodeServices.layer)),
)
